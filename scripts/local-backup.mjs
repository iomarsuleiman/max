import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, lstat, mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

async function directory(input) {
  const resolved = path.resolve(input);
  const stat = await lstat(resolved);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Expected a directory, not a link.");
  return realpath(resolved);
}

async function unusedDestination(input, source) {
  const resolved = path.resolve(await realpath(path.dirname(path.resolve(input))), path.basename(input));
  const comparable = (value) => process.platform === "win32" ? value.toLowerCase() : value;
  const a = comparable(source);
  const b = comparable(resolved);
  if (a === b || a.startsWith(b + path.sep) || b.startsWith(a + path.sep)) throw new Error("Source and destination must not overlap.");
  // mkdir without recursive/exist-ok is the exclusive claim; existing paths are never overwritten.
  await mkdir(resolved);
  return resolved;
}

async function digest(filename) {
  const hash = createHash("sha256");
  let size = 0;
  for await (const chunk of createReadStream(filename)) {
    size += chunk.length;
    hash.update(chunk);
  }
  return { size, sha256: hash.digest("hex") };
}

async function inventory(root, prefix = "") {
  const entries = await readdir(path.join(root, prefix), { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, "en"))) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new Error("Links are not supported in backups.");
    if (entry.isDirectory()) files.push(...await inventory(root, relative));
    else if (entry.isFile()) files.push({ path: relative, ...await digest(path.join(root, relative)) });
    else throw new Error("Only regular files and directories can be backed up.");
  }
  return files;
}

const V1_TABLES = ["pages", "documents", "assets", "comments", "versions", "settings", "tokens", "audit", "idempotency"];
const STORAGE_ID = /^[a-z0-9]{8,40}$/;
const HASH = /^[a-f0-9]{64}$/;
const RECEIPT_FIELDS = {
  issued: [], receiving: ["attemptId", "leaseUntil"], stored: ["blob", "receivedByAttemptId", "storedAt", "registerUntil"],
  registered: ["blob", "receivedByAttemptId", "assetId", "registrationKey", "registeredAt"],
  cleaning: ["blob", "cleanupId", "leaseUntil"], cleaned: ["blob", "cleanedAt"],
};
function identifier(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 300 && value.trim() === value && !/[\u0000-\u001f]/.test(value);
}
function timestamp(value) { return Number.isSafeInteger(value) && value >= 0; }

async function validateReceipts(root, db) {
  const ids = new Set();
  const hashes = new Set();
  const storageIds = new Set();
  for (const receipt of db.uploadReceipts) {
    if (!Object.hasOwn(RECEIPT_FIELDS, receipt.state)) throw new Error("Invalid upload receipt state.");
    const expected = ["_id", "id", "ownerId", "capabilityHash", "createdAt", "expiresAt", "state", ...RECEIPT_FIELDS[receipt.state]].sort();
    if (JSON.stringify(Object.keys(receipt).sort()) !== JSON.stringify(expected) || !identifier(receipt._id) || !identifier(receipt.id) || !identifier(receipt.ownerId) || !HASH.test(receipt.capabilityHash) || !timestamp(receipt.createdAt) || !timestamp(receipt.expiresAt) || receipt.expiresAt < receipt.createdAt || ids.has(receipt.id) || hashes.has(receipt.capabilityHash)) throw new Error("Invalid or duplicate upload receipt identity.");
    ids.add(receipt.id);
    hashes.add(receipt.capabilityHash);
    for (const field of ["attemptId", "receivedByAttemptId", "assetId", "registrationKey", "cleanupId"]) {
      if (Object.hasOwn(receipt, field) && !identifier(receipt[field])) throw new Error("Invalid upload receipt identifier.");
    }
    for (const field of ["leaseUntil", "storedAt", "registerUntil", "registeredAt", "cleanedAt"]) {
      if (Object.hasOwn(receipt, field) && !timestamp(receipt[field])) throw new Error("Invalid upload receipt timestamp.");
    }
    if (!Object.hasOwn(receipt, "blob")) continue;
    const blob = receipt.blob;
    if (!blob || typeof blob !== "object" || Array.isArray(blob) || JSON.stringify(Object.keys(blob).sort()) !== JSON.stringify(["sha256", "size", "storageId", "type"]) || typeof blob.storageId !== "string" || !STORAGE_ID.test(blob.storageId) || !Number.isSafeInteger(blob.size) || blob.size < 1 || blob.size > 50 * 1024 * 1024 || typeof blob.type !== "string" || blob.type.length > 100 || !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(blob.type) || !HASH.test(blob.sha256) || storageIds.has(blob.storageId)) throw new Error("Invalid or duplicate upload receipt blob.");
    storageIds.add(blob.storageId);
    if ((receipt.state === "cleaning" || receipt.state === "cleaned") && db.assets.some((asset) => asset.storageId === blob.storageId)) throw new Error("Upload cleanup receipt still has live attachment references.");
    if (receipt.state === "registered") {
      const asset = db.assets.find((row) => row._id === receipt.assetId);
      if (!asset || asset.ownerId !== receipt.ownerId || asset.storageId !== blob.storageId || asset.size !== blob.size || asset.type !== blob.type) throw new Error("Registered upload receipt does not match its attachment.");
    }
    const filename = path.join(root, "files", blob.storageId);
    let stat;
    try { stat = await lstat(filename); } catch (error) {
      if (error.code === "ENOENT" && (receipt.state === "cleaning" || receipt.state === "cleaned")) continue;
      throw error;
    }
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("An upload receipt file is missing or linked.");
    const measured = await digest(filename);
    const typeFile = path.join(root, "files", `${blob.storageId}.type`);
    const typeStat = await lstat(typeFile);
    if (!typeStat.isFile() || typeStat.isSymbolicLink() || measured.size !== blob.size || measured.sha256 !== blob.sha256 || await readFile(typeFile, "utf8") !== blob.type) throw new Error("Upload receipt bytes or MIME type do not match.");
  }
}

async function validateDatabase(root, expectedVersion) {
  const db = JSON.parse(await readFile(path.join(root, "db.json"), "utf8"));
  if (!db || typeof db !== "object" || Array.isArray(db) || !Array.isArray(db.pages) || !Array.isArray(db.documents)) throw new Error("Invalid local database snapshot.");
  const version = Object.hasOwn(db, "uploadReceipts") ? 2 : 1;
  const tables = version === 1 ? V1_TABLES : [...V1_TABLES, "uploadReceipts"];
  if ((expectedVersion !== undefined && expectedVersion !== version) || JSON.stringify(Object.keys(db).sort()) !== JSON.stringify([...tables].sort())) throw new Error("Local database tables do not match the backup version.");
  for (const rows of Object.values(db)) {
    if (!Array.isArray(rows) || rows.some((row) => !row || typeof row._id !== "string")) throw new Error("Invalid local database rows.");
    if (version === 2 && new Set(rows.map((row) => row._id)).size !== rows.length) throw new Error("Duplicate local database row IDs.");
  }
  // A database reference without its file would produce an unusable recovery image.
  for (const asset of db.assets ?? []) {
    if (typeof asset.storageId !== "string" || !/^[a-z0-9]{8,40}$/.test(asset.storageId)) throw new Error("Invalid local attachment storage ID.");
    const file = path.join(root, "files", asset.storageId);
    const stat = await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("An attachment is missing or linked.");
  }
  if (version === 2) await validateReceipts(root, db);
  return version;
}

async function copyInventory(source, destination, files) {
  for (const file of files) {
    const target = path.join(destination, file.path);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(path.join(source, file.path), target);
  }
}

function equalFiles(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export async function createBackup({ source, destination, stopped }) {
  if (stopped !== true) throw new Error("Stop Max first, then pass --stopped to acknowledge the offline backup requirement.");
  const root = await directory(source);
  const version = await validateDatabase(root);
  const files = await inventory(root);
  const target = await unusedDestination(destination, root);
  const data = path.join(target, "data");
  await mkdir(data);
  await copyInventory(root, data, files);
  if (!equalFiles(files, await inventory(data)) || !equalFiles(files, await inventory(root))) throw new Error("Files changed during backup. Stop Max and retry into a new directory.");
  const manifest = { format: "max-local-backup", version, createdAt: new Date().toISOString(), files };
  // Write last: an interrupted copy is never accepted as a finished backup.
  await writeFile(path.join(target, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
  await verifyBackup(target);
  return manifest;
}

export async function verifyBackup(backup) {
  const root = await directory(backup);
  const manifestPath = path.join(root, "manifest.json");
  const stat = await lstat(manifestPath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Expected a regular backup manifest.");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (manifest?.format !== "max-local-backup" || ![1, 2].includes(manifest.version) || !Array.isArray(manifest.files)) throw new Error("Unsupported backup manifest.");
  const seen = new Set();
  for (const file of manifest.files) {
    if (!file || typeof file.path !== "string" || /[\\:]/.test(file.path) || file.path.split("/").some((part) => !part || part === "." || part === "..") || !Number.isSafeInteger(file.size) || file.size < 0 || !/^[a-f0-9]{64}$/.test(file.sha256) || seen.has(file.path)) throw new Error("Invalid backup manifest entry.");
    seen.add(file.path);
  }
  const data = await directory(path.join(root, "data"));
  if (!equalFiles(manifest.files, await inventory(data))) throw new Error("Backup checksum or file inventory mismatch.");
  await validateDatabase(data, manifest.version);
  return manifest;
}

export async function restoreBackup({ backup, destination }) {
  const root = await directory(backup);
  const manifest = await verifyBackup(root);
  const target = await unusedDestination(destination, root);
  await copyInventory(path.join(root, "data"), target, manifest.files);
  if (!equalFiles(manifest.files, await inventory(target))) throw new Error("Restored files do not match the backup.");
  await validateDatabase(target, manifest.version);
  return manifest;
}

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    source: { type: "string" }, destination: { type: "string" }, backup: { type: "string" }, stopped: { type: "boolean" },
  } });
  const [command] = positionals;
  let result;
  if (command === "create" && values.source && values.destination) result = await createBackup({ ...values, source: values.source, destination: values.destination });
  else if (command === "verify" && values.backup) result = await verifyBackup(values.backup);
  else if (command === "restore" && values.backup && values.destination) result = await restoreBackup({ backup: values.backup, destination: values.destination });
  else throw new Error("Usage: local-backup.mjs create --source DIR --destination NEW_DIR --stopped | verify --backup DIR | restore --backup DIR --destination NEW_DIR");
  process.stdout.write(`${command}: verified ${result.files.length} files.\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
