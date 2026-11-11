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

async function validateDatabase(root) {
  const db = JSON.parse(await readFile(path.join(root, "db.json"), "utf8"));
  if (!db || typeof db !== "object" || Array.isArray(db) || !Array.isArray(db.pages) || !Array.isArray(db.documents)) throw new Error("Invalid local database snapshot.");
  for (const rows of Object.values(db)) {
    if (!Array.isArray(rows) || rows.some((row) => !row || typeof row._id !== "string")) throw new Error("Invalid local database rows.");
  }
  // A database reference without its file would produce an unusable recovery image.
  for (const asset of db.assets ?? []) {
    if (typeof asset.storageId !== "string" || !/^[a-z0-9]{8,40}$/.test(asset.storageId)) throw new Error("Invalid local attachment storage ID.");
    const file = path.join(root, "files", asset.storageId);
    const stat = await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("An attachment is missing or linked.");
  }
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
  await validateDatabase(root);
  const files = await inventory(root);
  const target = await unusedDestination(destination, root);
  const data = path.join(target, "data");
  await mkdir(data);
  await copyInventory(root, data, files);
  if (!equalFiles(files, await inventory(data)) || !equalFiles(files, await inventory(root))) throw new Error("Files changed during backup. Stop Max and retry into a new directory.");
  const manifest = { format: "max-local-backup", version: 1, createdAt: new Date().toISOString(), files };
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
  if (manifest?.format !== "max-local-backup" || manifest.version !== 1 || !Array.isArray(manifest.files)) throw new Error("Unsupported backup manifest.");
  const seen = new Set();
  for (const file of manifest.files) {
    if (!file || typeof file.path !== "string" || /[\\:]/.test(file.path) || file.path.split("/").some((part) => !part || part === "." || part === "..") || !Number.isSafeInteger(file.size) || file.size < 0 || !/^[a-f0-9]{64}$/.test(file.sha256) || seen.has(file.path)) throw new Error("Invalid backup manifest entry.");
    seen.add(file.path);
  }
  const data = await directory(path.join(root, "data"));
  if (!equalFiles(manifest.files, await inventory(data))) throw new Error("Backup checksum or file inventory mismatch.");
  await validateDatabase(data);
  return manifest;
}

export async function restoreBackup({ backup, destination }) {
  const root = await directory(backup);
  const manifest = await verifyBackup(root);
  const target = await unusedDestination(destination, root);
  await copyInventory(path.join(root, "data"), target, manifest.files);
  if (!equalFiles(manifest.files, await inventory(target))) throw new Error("Restored files do not match the backup.");
  await validateDatabase(target);
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
