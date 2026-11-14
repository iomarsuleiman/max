import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { createBackup, restoreBackup, verifyBackup } from "../../scripts/local-backup.mjs";

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "max-backup-test-"));
  t.after(() => {
    const relative = path.relative(path.resolve(tmpdir()), path.resolve(root));
    assert.ok(!relative.startsWith("..") && !path.isAbsolute(relative) && path.basename(root).startsWith("max-backup-test-"));
    return rm(root, { recursive: true, force: true });
  });
  const source = path.join(root, "source");
  await mkdir(path.join(source, "files"), { recursive: true });
  const bytes = Buffer.from([0, 255, 128, 10, 13, 42]);
  const db = JSON.stringify({ pages: [{ _id: "page-id", ownerId: "local", title: "العربية" }], documents: [{ _id: "document-id", ownerId: "local", pageId: "page-id", revision: 9, content: '[{"id":"stable-block"}]' }], assets: [{ _id: "asset-id", ownerId: "local", storageId: "attachment01" }], comments: [{ _id: "comment-id", ownerId: "local", pageId: "page-id" }], versions: [], settings: [], tokens: [], audit: [], idempotency: [] });
  await writeFile(path.join(source, "db.json"), db);
  await writeFile(path.join(source, "files", "attachment01"), bytes);
  await writeFile(path.join(source, "files", "attachment01.type"), "application/octet-stream");
  return { source, destination: path.join(root, "backup"), restored: path.join(root, "restored"), root, bytes, db, stopped: true };
}

test("backs up and restores exact database and attachment bytes into a new directory", async (t) => {
  const f = await fixture(t);
  const created = await createBackup(f);
  assert.equal(created.version, 1);
  assert.equal(created.files.length, 3);
  assert.deepEqual(await verifyBackup(f.destination), created);
  await restoreBackup({ backup: f.destination, destination: f.restored });
  assert.equal(await readFile(path.join(f.restored, "db.json"), "utf8"), f.db);
  assert.deepEqual(await readFile(path.join(f.restored, "files", "attachment01")), f.bytes);
  assert.equal(await readFile(path.join(f.restored, "files", "attachment01.type"), "utf8"), "application/octet-stream");
  assert.equal(await readFile(path.join(f.source, "db.json"), "utf8"), f.db);
});

test("CLI creates, verifies and restores a backup", async (t) => {
  const f = await fixture(t);
  const script = path.resolve("scripts/local-backup.mjs");
  for (const args of [
    ["create", "--source", f.source, "--destination", f.destination, "--stopped"],
    ["verify", "--backup", f.destination],
    ["restore", "--backup", f.destination, "--destination", f.restored],
  ]) {
    const result = spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /verified 3 files/);
  }
});

test("refuses an unacknowledged live backup and existing or overlapping destinations", async (t) => {
  const f = await fixture(t);
  await assert.rejects(createBackup({ ...f, stopped: false }), /Stop Max/);
  await assert.rejects(createBackup({ ...f, destination: f.source }), /overlap/);
  await assert.rejects(createBackup({ ...f, destination: path.join(f.source, "nested") }), /overlap/);
  await assert.rejects(createBackup({ ...f, destination: f.root }), /overlap/);
  await createBackup(f);
  await assert.rejects(createBackup(f), { code: "EEXIST" });
  await assert.rejects(restoreBackup({ backup: f.destination, destination: f.source }), { code: "EEXIST" });
  assert.equal(await readFile(path.join(f.source, "db.json"), "utf8"), f.db);
});

for (const damage of ["changed", "missing", "extra"]) {
  test(`refuses a backup with ${damage} attachment bytes`, async (t) => {
    const f = await fixture(t);
    await createBackup(f);
    const attachment = path.join(f.destination, "data", "files", "attachment01");
    if (damage === "missing") await rm(attachment);
    else if (damage === "changed") await writeFile(attachment, "corrupted");
    else await writeFile(path.join(f.destination, "data", "extra"), "unlisted");
    await assert.rejects(verifyBackup(f.destination), /mismatch/);
    await assert.rejects(restoreBackup({ backup: f.destination, destination: f.restored }), /mismatch/);
  });
}

test("rejects traversal in manifests and missing source attachment files", async (t) => {
  const f = await fixture(t);
  await createBackup(f);
  const manifest = await verifyBackup(f.destination);
  manifest.files[0].path = "../outside";
  await writeFile(path.join(f.destination, "manifest.json"), JSON.stringify(manifest));
  await assert.rejects(verifyBackup(f.destination), /Invalid backup manifest/);
  await rm(path.join(f.source, "files", "attachment01"));
  await assert.rejects(createBackup({ ...f, destination: f.restored }), { code: "ENOENT" });
});

test("rejects linked directories inside source and backup data", async (t) => {
  const f = await fixture(t);
  const external = path.join(f.root, "external");
  await mkdir(external);
  await createBackup(f);
  // Windows junctions can be created without developer mode or elevation.
  await symlink(external, path.join(f.source, "linked"), process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(createBackup({ ...f, destination: f.restored }), /Links/);
  await symlink(external, path.join(f.destination, "data", "linked"), process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(verifyBackup(f.destination), /Links/);
});

async function uploadFixture(t) {
  const f = await fixture(t);
  const db = JSON.parse(f.db);
  db.assets[0] = { ...db.assets[0], size: f.bytes.length, type: "application/octet-stream" };
  const hash = createHash("sha256").update(f.bytes).digest("hex");
  const identity = (index) => ({ _id: `row-${index}`, id: `receipt-${index}`, ownerId: "local", capabilityHash: index.toString(16).padStart(64, "0"), createdAt: 1000, expiresAt: 2000 });
  const blob = (storageId) => ({ storageId, size: f.bytes.length, type: "application/octet-stream", sha256: hash });
  db.uploadReceipts = [
    { ...identity(1), state: "issued" },
    { ...identity(2), state: "receiving", attemptId: "attempt-2", leaseUntil: 1500 },
    { ...identity(3), state: "stored", blob: blob("pendingfile01"), receivedByAttemptId: "attempt-3", storedAt: 1100, registerUntil: 3000 },
    { ...identity(4), state: "registered", blob: blob("attachment01"), receivedByAttemptId: "attempt-4", assetId: "asset-id", registrationKey: "registration", registeredAt: 1200 },
    { ...identity(5), state: "cleaning", blob: blob("cleaningfile01"), cleanupId: "cleanup-5", leaseUntil: 2500 },
    { ...identity(6), state: "cleaned", blob: blob("deletedfile01"), cleanedAt: 2000 },
  ];
  for (const storageId of ["pendingfile01", "cleaningfile01"]) {
    await writeFile(path.join(f.source, "files", storageId), f.bytes);
    await writeFile(path.join(f.source, "files", `${storageId}.type`), "application/octet-stream");
  }
  const serialized = JSON.stringify(db);
  await writeFile(path.join(f.source, "db.json"), serialized);
  return { ...f, db: serialized, snapshot: db };
}

async function replaceBackupDatabase(backup, snapshot) {
  const bytes = Buffer.from(JSON.stringify(snapshot));
  await writeFile(path.join(backup, "data", "db.json"), bytes);
  const manifest = JSON.parse(await readFile(path.join(backup, "manifest.json"), "utf8"));
  const entry = manifest.files.find((file) => file.path === "db.json");
  assert.ok(entry);
  entry.size = bytes.length;
  entry.sha256 = createHash("sha256").update(bytes).digest("hex");
  await writeFile(path.join(backup, "manifest.json"), JSON.stringify(manifest));
}

test("v2 preserves exact receipt-sensitive snapshots and pending upload bytes through restore", async (t) => {
  const f = await uploadFixture(t);
  const manifest = await createBackup(f);
  assert.equal(manifest.version, 2);
  assert.deepEqual(await verifyBackup(f.destination), manifest);
  await restoreBackup({ backup: f.destination, destination: f.restored });
  assert.equal(await readFile(path.join(f.restored, "db.json"), "utf8"), f.db);
  for (const storageId of ["attachment01", "pendingfile01", "cleaningfile01"])
    assert.deepEqual(await readFile(path.join(f.restored, "files", storageId)), f.bytes);
  const result = spawnSync(process.execPath, [path.resolve("scripts/local-backup.mjs"), "verify", "--backup", f.destination], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^verify: verified 7 files\.\s*$/);
  assert.ok(!result.stdout.includes(f.snapshot.uploadReceipts[0].capabilityHash));
});

test("both versions require exact table sets and cannot reinterpret receipt data after manifest edits", async (t) => {
  const f = await fixture(t);
  const db = JSON.parse(f.db);
  db.unknown = [];
  await writeFile(path.join(f.source, "db.json"), JSON.stringify(db));
  await assert.rejects(createBackup(f), /tables/);
  delete db.unknown;
  delete db.tokens;
  await writeFile(path.join(f.source, "db.json"), JSON.stringify(db));
  await assert.rejects(createBackup(f), /tables/);
  const f2 = await uploadFixture(t);
  await createBackup(f2);
  const manifest = JSON.parse(await readFile(path.join(f2.destination, "manifest.json"), "utf8"));
  manifest.version = 1;
  await writeFile(path.join(f2.destination, "manifest.json"), JSON.stringify(manifest));
  await assert.rejects(verifyBackup(f2.destination), /tables/);
  await assert.rejects(restoreBackup({ backup: f2.destination, destination: f2.restored }), /tables/);
  manifest.version = 2;
  await writeFile(path.join(f2.destination, "manifest.json"), JSON.stringify(manifest));
  delete f2.snapshot.uploadReceipts;
  await replaceBackupDatabase(f2.destination, f2.snapshot);
  await assert.rejects(verifyBackup(f2.destination), /tables/);
});

for (const corruption of ["logical id", "capability hash", "storage id", "registered owner", "registered metadata", "receipt state", "plaintext capability", "blob digest", "duplicate row id"]) {
  test(`v2 rejects ${corruption} corruption even with repaired inventory checksums`, async (t) => {
    const f = await uploadFixture(t);
    await createBackup(f);
    const rows = f.snapshot.uploadReceipts;
    if (corruption === "logical id") rows[1].id = rows[0].id;
    if (corruption === "capability hash") rows[1].capabilityHash = rows[0].capabilityHash;
    if (corruption === "storage id") rows[4].blob.storageId = rows[2].blob.storageId;
    if (corruption === "registered owner") rows[3].ownerId = "foreign";
    if (corruption === "registered metadata") f.snapshot.assets[0].size++;
    if (corruption === "receipt state") rows[0].state = "unknown";
    if (corruption === "plaintext capability") rows[0].capability = "must-never-be-persisted";
    if (corruption === "blob digest") rows[2].blob.sha256 = "a".repeat(64);
    if (corruption === "duplicate row id") rows[1]._id = rows[0]._id;
    await replaceBackupDatabase(f.destination, f.snapshot);
    await assert.rejects(verifyBackup(f.destination), /receipt|Duplicate local/i);
    await assert.rejects(restoreBackup({ backup: f.destination, destination: f.restored }), /receipt|Duplicate local/i);
  });
}

for (const problem of ["pending bytes", "pending MIME"]) {
  test(`v2 refuses missing ${problem} before creating a backup`, async (t) => {
    const f = await uploadFixture(t);
    await rm(path.join(f.source, "files", problem === "pending bytes" ? "pendingfile01" : "pendingfile01.type"));
    await assert.rejects(createBackup(f), { code: "ENOENT" });
  });
}

test("v2 preserves interrupted cleanup receipts after their unreferenced physical files were deleted", async (t) => {
  const f = await uploadFixture(t);
  await rm(path.join(f.source, "files", "cleaningfile01"));
  await rm(path.join(f.source, "files", "cleaningfile01.type"));
  const created = await createBackup(f);
  assert.equal(created.version, 2);
  assert.deepEqual(await verifyBackup(f.destination), created);
  await restoreBackup({ backup: f.destination, destination: f.restored });
  assert.equal(await readFile(path.join(f.restored, "db.json"), "utf8"), f.db);
  await assert.rejects(readFile(path.join(f.restored, "files", "cleaningfile01")), { code: "ENOENT" });
  assert.deepEqual(await readFile(path.join(f.restored, "files", "pendingfile01")), f.bytes);
});

for (const state of ["cleaning", "cleaned"]) {
  test(`v2 rejects ${state} receipts with live attachment references from any account`, async (t) => {
    const f = await uploadFixture(t);
    await createBackup(f);
    if (state === "cleaned") {
      const prior = f.snapshot.uploadReceipts[4];
      const { cleanupId: _claim, leaseUntil: _lease, ...receipt } = prior;
      f.snapshot.uploadReceipts[4] = { ...receipt, state: "cleaned", cleanedAt: 2500 };
    }
    f.snapshot.assets.push({ _id: "foreign-reference", ownerId: "foreign", storageId: "cleaningfile01", size: f.bytes.length, type: "application/octet-stream" });
    await replaceBackupDatabase(f.destination, f.snapshot);
    await assert.rejects(verifyBackup(f.destination), /cleanup receipt still has live attachment references/);
    await assert.rejects(restoreBackup({ backup: f.destination, destination: f.restored }), /cleanup receipt still has live attachment references/);
  });
}
