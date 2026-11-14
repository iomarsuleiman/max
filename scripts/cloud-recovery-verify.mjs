import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync } from "fflate";

const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 1024 * 1024 * 1024;
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  }
  return value;
}

function parseLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    // JSON.parse errors can quote private document text. Keep CLI failures redacted.
    throw new Error("Invalid JSON in snapshot.");
  }
}

/** Read-only verifier. Never extracts files, connects to Convex, or writes data. */
export function inventorySnapshot(bytes) {
  if (bytes.length > MAX_ARCHIVE_BYTES) throw new Error("Snapshot exceeds the 512 MiB verification limit.");
  let expanded = 0;
  const names = new Set();
  const entries = unzipSync(bytes, {
    filter(entry) {
      if (entry.name.startsWith("/") || entry.name.includes("\\") || entry.name.split("/").some((part) => part === ".." || part === ".")) {
        throw new Error("Unsafe snapshot entry path.");
      }
      if (names.has(entry.name)) throw new Error("Duplicate snapshot entry.");
      names.add(entry.name);
      expanded += entry.originalSize;
      if (expanded > MAX_EXPANDED_BYTES || names.size > 100_000) throw new Error("Snapshot exceeds verification expansion limits.");
      return !entry.name.endsWith("/");
    },
  });
  const tables = Object.create(null);
  const files = Object.create(null);
  const schemas = Object.create(null);
  for (const [name, data] of Object.entries(entries).sort(([a], [b]) => a.localeCompare(b))) {
    if (name.endsWith("/documents.jsonl")) {
      const table = name.slice(0, -"/documents.jsonl".length);
      const rows = new TextDecoder("utf-8", { fatal: true })
        .decode(data)
        .split(/\r?\n/)
        .filter((line) => line.trim())
        .map(parseLine);
      const ids = new Set();
      for (const row of rows) {
        const rowId = table === "_tables" ? row?.name : row?._id;
        if (
          !row ||
          typeof row !== "object" ||
          Array.isArray(row) ||
          typeof rowId !== "string" ||
          ids.has(rowId) ||
          (table === "_tables" && !Number.isInteger(row.id))
        ) {
          throw new Error(`Invalid or duplicate row in ${table}.`);
        }
        ids.add(rowId);
      }
      rows.sort((a, b) => (table === "_tables" ? a.name.localeCompare(b.name) : a._id.localeCompare(b._id)));
      tables[table] = { rows: rows.length, sha256: hash(JSON.stringify(canonical(rows))) };
      // Retain private rows only in this function's memory for referential validation.
      if (table === "assets") tables[table].storageIds = rows.map((row) => row.storageId);
      if (table === "_storage") tables[table].storageIds = rows.map((row) => row._id);
    } else if (name.startsWith("_storage/")) {
      files[name] = { bytes: data.length, sha256: hash(data) };
    } else if (name.endsWith("/generated_schema.jsonl")) {
      // Type inference metadata preserves Convex values such as bytes and Int64.
      const lines = new TextDecoder("utf-8", { fatal: true })
        .decode(data)
        .split(/\r?\n/)
        .filter((line) => line.trim());
      schemas[name] = hash(JSON.stringify(lines.map((line) => JSON.stringify(canonical(parseLine(line)))).sort()));
    } else if (name !== "README.md") {
      throw new Error(`Unsupported snapshot entry: ${name}`);
    }
  }
  if (!tables.pages || !tables.documents) throw new Error("Snapshot must include Max pages and documents tables.");
  const storageIds = new Set(tables._storage?.storageIds ?? []);
  for (const storageId of tables.assets?.storageIds ?? []) {
    if (typeof storageId !== "string" || !storageIds.has(storageId)) throw new Error("An asset has no exported storage metadata.");
  }
  for (const storageId of storageIds) {
    if (!Object.keys(files).some((name) => name === `_storage/${storageId}` || name.startsWith(`_storage/${storageId}.`))) {
      throw new Error("Storage bytes are missing. Export with --include-file-storage.");
    }
  }
  for (const table of Object.values(tables)) delete table.storageIds;
  return { tables, files, schemas };
}

export function compareSnapshots(sourceBytes, restoredBytes) {
  const source = inventorySnapshot(sourceBytes);
  const restored = inventorySnapshot(restoredBytes);
  if (JSON.stringify(source) !== JSON.stringify(restored))
    throw new Error("Restored snapshot differs from the source. Preserve both archives for investigation.");
  return {
    tables: Object.keys(source.tables).length,
    rows: Object.values(source.tables).reduce((sum, table) => sum + table.rows, 0),
    attachments: Object.keys(source.files).length,
    attachmentBytes: Object.values(source.files).reduce((sum, file) => sum + file.bytes, 0),
    sourceSha256: hash(sourceBytes),
    restoredSha256: hash(restoredBytes),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 4) throw new Error("Usage: node scripts/cloud-recovery-verify.mjs source.zip restored.zip");
    const result = compareSnapshots(await readFile(process.argv[2]), await readFile(process.argv[3]));
    console.log(JSON.stringify({ verified: true, ...result }, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Snapshot verification failed.");
    process.exitCode = 1;
  }
}
