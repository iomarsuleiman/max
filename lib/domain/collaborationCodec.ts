/**
 * Max 2.0 PR12: a provider-neutral, read-only compatibility boundary for
 * evaluating collaborative transports against persisted BlockNote documents.
 *
 * This is NOT a live collaboration transport, permission check, or migration.
 * Unknown fields are preserved; destructive normalization is not permitted.
 */
import { DOCUMENT_SCHEMA_VERSION, MAX_CONTENT_BYTES, type Block } from "./blocks";

export const MAX_COLLAB_BLOCKS = 20_000;
export const MAX_COLLAB_DEPTH = 64;
export type TransportCandidate = "convex-prosemirror-sync" | "blocknote-yjs";

export class UnsafeCollaborationDocument extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeCollaborationDocument";
  }
}

export interface VerifiedLegacyContent {
  /** Exact original storage bytes are never rewritten by the verifier. */
  raw: string;
  /** JSON representation for structural comparisons; not a migration output. */
  canonical: string;
  blocks: readonly Block[];
  blockIds: readonly string[];
  blockTypes: readonly string[];
  sizeBytes: number;
  schemaVersion: number;
}

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function validInlineList(content: unknown): boolean {
  if (!Array.isArray(content)) return false;
  return content.every((item) => record(item) && typeof item.type === "string" && item.type.length > 0);
}

function validContent(content: unknown): boolean {
  if (content === undefined) return true;
  if (Array.isArray(content)) return validInlineList(content);
  if (!record(content) || content.type !== "tableContent" || !Array.isArray(content.rows)) return false;
  if (content.columnWidths !== undefined && !Array.isArray(content.columnWidths)) return false;
  return content.rows.every((row) => record(row) && Array.isArray(row.cells) &&
    row.cells.every((cell: unknown) => Array.isArray(cell)
      ? validInlineList(cell)
      : record(cell) && cell.type === "tableCell" && validInlineList(cell.content)));
}

/**
 * Validate existing persisted JSON without calling normalizeBlocks: that method
 * repairs input by generating IDs, which would make a collaboration migration lossy.
 */
export function inspectLegacyContent(raw: string, schemaVersion: number): VerifiedLegacyContent {
  if (schemaVersion !== DOCUMENT_SCHEMA_VERSION) throw new UnsafeCollaborationDocument("Unsupported document schema version");
  if (typeof raw !== "string") throw new UnsafeCollaborationDocument("Document content must be a string");
  const sizeBytes = new TextEncoder().encode(raw).byteLength;
  if (sizeBytes > MAX_CONTENT_BYTES) throw new UnsafeCollaborationDocument("Document exceeds the content size limit");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new UnsafeCollaborationDocument("Invalid document JSON");
  }
  if (!Array.isArray(parsed)) throw new UnsafeCollaborationDocument("Document root must be an array");
  const ids = new Set<string>();
  const types = new Set<string>();
  const stack: { value: unknown; depth: number }[] = parsed.map((value) => ({ value, depth: 1 }));
  while (stack.length) {
    const { value, depth } = stack.pop()!;
    if (depth > MAX_COLLAB_DEPTH) throw new UnsafeCollaborationDocument("Document nesting exceeds safe depth");
    if (!record(value) || typeof value.id !== "string" || !value.id ||
      typeof value.type !== "string" || !value.type || !record(value.props) ||
      !Array.isArray(value.children) || !validContent(value.content)) {
      throw new UnsafeCollaborationDocument("Malformed persisted block; refusing a lossy repair");
    }
    if (ids.has(value.id)) throw new UnsafeCollaborationDocument("Duplicate block ID");
    ids.add(value.id);
    if (ids.size > MAX_COLLAB_BLOCKS) throw new UnsafeCollaborationDocument("Too many blocks");
    types.add(value.type);
    for (const child of value.children) stack.push({ value: child, depth: depth + 1 });
  }
  // JSON.stringify only canonicalizes the parsed structure. It never changes raw.
  const canonical = JSON.stringify(parsed);
  return { raw, canonical, blocks: parsed as Block[], blockIds: [...ids], blockTypes: [...types].sort(), sizeBytes, schemaVersion };
}

export interface CollaborationCodec<Wire> {
  readonly candidate: TransportCandidate;
  encode(blocks: readonly Block[]): Wire;
  decode(payload: Wire): unknown;
}

export interface CodecProbeResult {
  candidate: TransportCandidate;
  compatible: boolean;
  blockCount: number;
  /** A failed probe contains no converted document that could be persisted. */
  reason: string | null;
}

/**
 * A strict offline probe, NOT a shared editor session. A candidate may only pass
 * when it round-trips the entire canonical JSON including custom block data.
 * Independent live sync, conflicts and authorization must be separately tested.
 */
export function probeCollaborationCodec<Wire>(
  source: VerifiedLegacyContent,
  codec: CollaborationCodec<Wire>,
): CodecProbeResult {
  try {
    // Pass a deep copy so a candidate cannot mutate the source snapshot.
    const sourceCopy = JSON.parse(source.canonical) as Block[];
    const decoded = codec.decode(codec.encode(sourceCopy));
    const candidateRaw = JSON.stringify(decoded);
    if (typeof candidateRaw !== "string") throw new UnsafeCollaborationDocument("Codec returned no document");
    const candidate = inspectLegacyContent(candidateRaw, source.schemaVersion);
    if (candidate.canonical !== source.canonical) throw new UnsafeCollaborationDocument("Round trip changed block content, order, IDs or metadata");
    return { candidate: codec.candidate, compatible: true, blockCount: source.blockIds.length, reason: null };
  } catch (error) {
    return { candidate: codec.candidate, compatible: false, blockCount: source.blockIds.length,
      reason: error instanceof Error ? error.message : "Unknown codec failure" };
  }
}

/** No code in this PR opens a transport connection or grants access to a page. */
export const COLLABORATIVE_EDITING_ENABLED = false as const;
