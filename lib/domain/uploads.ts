import { MaxError, notFound } from "./errors";
import { LIMITS } from "./ops/helpers";

export const UPLOAD_LIMITS = Object.freeze({
  bytes: LIMITS.uploadBytes,
  ticketMs: 15 * 60_000,
  receiveLeaseMs: 2 * 60_000,
  pendingMs: 24 * 60 * 60_000,
  cleanupLeaseMs: 2 * 60_000,
});

export interface StoredUpload {
  storageId: string;
  size: number;
  type: string;
  sha256: string;
}
interface ReceiptIdentity {
  id: string;
  ownerId: string;
  capabilityHash: string;
  createdAt: number;
  expiresAt: number;
}
export type UploadReceipt = ReceiptIdentity &
  (
    | { state: "issued" }
    | { state: "receiving"; attemptId: string; leaseUntil: number }
    | { state: "stored"; blob: StoredUpload; receivedByAttemptId: string; storedAt: number; registerUntil: number }
    | { state: "registered"; blob: StoredUpload; receivedByAttemptId: string; assetId: string; registrationKey: string; registeredAt: number }
    | { state: "cleaning"; blob: StoredUpload; cleanupId: string; leaseUntil: number }
    | { state: "cleaned"; blob: StoredUpload; cleanedAt: number }
  );

/** Indexed unique reads and writes, all inside ONE outer native transaction. */
export interface UploadTransaction {
  get(id: string): Promise<UploadReceipt | null>;
  getByCapabilityHash(hash: string): Promise<UploadReceipt | null>;
  /** Must also find registered/cleaning receipts and reject duplicate IDs. */
  getByStorageId(storageId: string): Promise<UploadReceipt | null>;
  insert(receipt: UploadReceipt): Promise<void>;
  put(receipt: UploadReceipt): Promise<void>;
}
export interface UploadStore {
  /** Roll back receipt AND commitAsset writes on errors; never split transactions. */
  transaction<T>(body: (tx: UploadTransaction) => Promise<T>): Promise<T>;
}
/** Trusted adapter runtime. Never parse these values from client bodies. */
export interface UploadRuntime {
  now(): number;
  newId(): string;
  createCapability(): string;
  hashCapability(capability: string): Promise<string>;
}
export interface UploadAttempt {
  receiptId: string;
  ownerId: string;
  attemptId: string;
}
export interface UploadCleanup {
  receiptId: string;
  cleanupId: string;
  storageId: string;
}
export type BeginUploadResult =
  | { state: "receiving"; attempt: UploadAttempt; leaseUntil: number }
  | { state: "stored"; blob: StoredUpload }
  | { state: "registered"; blob: StoredUpload; assetId: string };

const capabilityPattern = /^max-upload-v1\.[a-f0-9]{64}$/;
const hashPattern = /^[a-f0-9]{64}$/;
const missing = () => notFound("upload");
function identifier(value: string): string {
  if (typeof value !== "string" || !value || value.length > 300 || value.trim() !== value || /[\u0000-\u001f]/.test(value))
    throw new MaxError("VALIDATION", "Invalid upload identifier.");
  return value;
}
function metadata(blob: StoredUpload): StoredUpload {
  identifier(blob.storageId);
  if (!Number.isSafeInteger(blob.size) || blob.size < 1 || blob.size > UPLOAD_LIMITS.bytes)
    throw new MaxError("LIMIT", "The uploaded file exceeds the supported size.");
  if (typeof blob.type !== "string" || blob.type.length > 100 || !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(blob.type) || !hashPattern.test(blob.sha256))
    throw new MaxError("VALIDATION", "Upload metadata is invalid.");
  return { storageId: blob.storageId, size: blob.size, type: blob.type, sha256: blob.sha256 };
}
function sameBlob(a: StoredUpload, b: StoredUpload): boolean {
  return a.storageId === b.storageId && a.size === b.size && a.type === b.type && a.sha256 === b.sha256;
}

/**
 * Ownership comes only from issue's authenticated owner and complete's trusted
 * byte receiver. A caller-supplied storage ID can never create a receipt.
 * No method deletes bytes. Cleanup claims are committed before external deletion.
 */
export class UploadService {
  constructor(
    private readonly store: UploadStore,
    private readonly runtime: UploadRuntime,
  ) {}

  private now(): number {
    const now = this.runtime.now();
    if (!Number.isSafeInteger(now) || now < 0 || now > Number.MAX_SAFE_INTEGER - UPLOAD_LIMITS.pendingMs)
      throw new MaxError("INTERNAL", "The upload clock is unavailable.");
    return now;
  }

  async issue(ownerId: string): Promise<{ capability: string; expiresAt: number }> {
    const capability = this.runtime.createCapability();
    if (!capabilityPattern.test(capability)) throw new MaxError("INTERNAL", "Upload capability generation failed.");
    const capabilityHash = await this.runtime.hashCapability(capability);
    const { expiresAt } = await this.issuePrepared(ownerId, { id: this.runtime.newId(), capabilityHash });
    return { capability, expiresAt };
  }

  /** Trusted action prepared entropy only; keep raw capabilities out of mutation traces. */
  async issuePrepared(ownerId: string, prepared: { id: string; capabilityHash: string }): Promise<{ expiresAt: number }> {
    identifier(ownerId);
    identifier(prepared.id);
    if (!hashPattern.test(prepared.capabilityHash)) throw new MaxError("INTERNAL", "Upload capability hashing failed.");
    return this.store.transaction(async (tx) => {
      if (await tx.getByCapabilityHash(prepared.capabilityHash)) throw new MaxError("CONFLICT", "Upload capability already exists.");
      const now = this.now();
      const receipt: UploadReceipt = {
        id: prepared.id,
        ownerId,
        capabilityHash: prepared.capabilityHash,
        createdAt: now,
        expiresAt: now + UPLOAD_LIMITS.ticketMs,
        state: "issued",
      };
      await tx.insert(receipt);
      return { expiresAt: receipt.expiresAt };
    });
  }

  async begin(capability: string): Promise<BeginUploadResult> {
    if (!capabilityPattern.test(capability)) throw missing();
    const hash = await this.runtime.hashCapability(capability);
    return this.beginHashed(hash);
  }

  /** Trusted HTTP receiver hashes the capability before calling an internal mutation. */
  async beginHashed(hash: string): Promise<BeginUploadResult> {
    if (!hashPattern.test(hash)) throw missing();
    return this.store.transaction(async (tx) => {
      const receipt = await tx.getByCapabilityHash(hash);
      const now = this.now();
      if (!receipt || receipt.expiresAt <= now) throw missing();
      // Successful retries never store a second copy after an uncertain HTTP ack.
      if (receipt.state === "registered") return { state: "registered", blob: receipt.blob, assetId: receipt.assetId };
      if (receipt.state === "stored" && receipt.registerUntil > now) return { state: "stored", blob: receipt.blob };
      if (receipt.state === "stored" || receipt.state === "cleaning" || receipt.state === "cleaned") throw missing();
      if (receipt.state === "receiving" && receipt.leaseUntil > now) throw new MaxError("CONFLICT", "This upload is already receiving bytes.");
      const attemptId = identifier(this.runtime.newId());
      const leaseUntil = Math.min(receipt.expiresAt, now + UPLOAD_LIMITS.receiveLeaseMs);
      await tx.put({ ...receipt, state: "receiving", attemptId, leaseUntil });
      return { state: "receiving", attempt: { receiptId: receipt.id, ownerId: receipt.ownerId, attemptId }, leaseUntil };
    });
  }

  /** Call only with metadata measured by the trusted receiver, never client JSON. */
  async complete(attempt: UploadAttempt, actualBlob: StoredUpload): Promise<StoredUpload> {
    const blob = metadata(actualBlob);
    return this.store.transaction(async (tx) => {
      const receipt = await tx.get(attempt.receiptId);
      if (!receipt || receipt.ownerId !== attempt.ownerId) throw missing();
      if ((receipt.state === "stored" || receipt.state === "registered") && receipt.receivedByAttemptId === attempt.attemptId && sameBlob(receipt.blob, blob))
        return receipt.blob;
      const now = this.now();
      if (receipt.state !== "receiving" || receipt.attemptId !== attempt.attemptId || receipt.leaseUntil <= now || receipt.expiresAt <= now)
        throw new MaxError("CONFLICT", "This upload attempt expired or was replaced.");
      const existing = await tx.getByStorageId(blob.storageId);
      if (existing && existing.id !== receipt.id) throw new MaxError("CONFLICT", "These stored bytes already belong to another upload.");
      await tx.put({
        id: receipt.id,
        ownerId: receipt.ownerId,
        capabilityHash: receipt.capabilityHash,
        createdAt: receipt.createdAt,
        expiresAt: receipt.expiresAt,
        state: "stored",
        blob,
        receivedByAttemptId: attempt.attemptId,
        storedAt: now,
        registerUntil: now + UPLOAD_LIMITS.pendingMs,
      });
      return blob;
    });
  }

  /** commitAsset must check fresh destination authority and write in this transaction. */
  async register(
    ownerId: string,
    expected: Pick<StoredUpload, "storageId" | "size" | "type">,
    registrationKey: string,
    commitAsset: (blob: StoredUpload) => Promise<string>,
    authorizeReplay: (assetId: string) => Promise<void>,
  ): Promise<{ assetId: string; replay: boolean }> {
    identifier(ownerId);
    identifier(expected.storageId);
    identifier(registrationKey);
    return this.store.transaction(async (tx) => {
      const receipt = await tx.getByStorageId(expected.storageId);
      if (!receipt || receipt.ownerId !== ownerId || (receipt.state !== "stored" && receipt.state !== "registered")) throw missing();
      if (receipt.blob.size !== expected.size || receipt.blob.type !== expected.type)
        throw new MaxError("CONFLICT", "The attachment metadata does not match the received file.");
      if (receipt.state === "registered") {
        if (receipt.registrationKey !== registrationKey) throw new MaxError("CONFLICT", "This upload was registered with different attachment details.");
        await authorizeReplay(receipt.assetId);
        return { assetId: receipt.assetId, replay: true };
      }
      const now = this.now();
      if (receipt.registerUntil <= now) throw missing();
      const assetId = identifier(await commitAsset(receipt.blob));
      await tx.put({
        id: receipt.id,
        ownerId: receipt.ownerId,
        capabilityHash: receipt.capabilityHash,
        createdAt: receipt.createdAt,
        expiresAt: receipt.expiresAt,
        state: "registered",
        blob: receipt.blob,
        receivedByAttemptId: receipt.receivedByAttemptId,
        assetId,
        registrationKey,
        registeredAt: now,
      });
      return { assetId, replay: false };
    });
  }

  /** Trusted sweeper supplies an indexed expired candidate, not a public API. */
  async claimCleanup(receiptId: string): Promise<UploadCleanup | null> {
    return this.store.transaction(async (tx) => {
      const receipt = await tx.get(receiptId);
      const now = this.now();
      if (!receipt || (receipt.state !== "stored" && receipt.state !== "cleaning")) return null;
      if (receipt.state === "stored" ? receipt.registerUntil > now : receipt.leaseUntil > now) return null;
      const cleanupId = identifier(this.runtime.newId());
      await tx.put({
        id: receipt.id,
        ownerId: receipt.ownerId,
        capabilityHash: receipt.capabilityHash,
        createdAt: receipt.createdAt,
        expiresAt: receipt.expiresAt,
        state: "cleaning",
        blob: receipt.blob,
        cleanupId,
        leaseUntil: now + UPLOAD_LIMITS.cleanupLeaseMs,
      });
      return { receiptId: receipt.id, cleanupId, storageId: receipt.blob.storageId };
    });
  }

  /** Only after idempotent storage deletion succeeds. A lost ack may retry later. */
  async completeCleanup(claim: UploadCleanup): Promise<void> {
    await this.store.transaction(async (tx) => {
      const receipt = await tx.get(claim.receiptId);
      if (receipt?.state === "cleaned" && receipt.blob.storageId === claim.storageId) return;
      if (!receipt || receipt.state !== "cleaning" || receipt.cleanupId !== claim.cleanupId || receipt.blob.storageId !== claim.storageId)
        throw new MaxError("CONFLICT", "This cleanup claim was replaced.");
      await tx.put({
        id: receipt.id,
        ownerId: receipt.ownerId,
        capabilityHash: receipt.capabilityHash,
        createdAt: receipt.createdAt,
        expiresAt: receipt.expiresAt,
        state: "cleaned",
        blob: receipt.blob,
        cleanedAt: this.now(),
      });
    });
  }
}
