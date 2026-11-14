import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { setup } from "./harness";

const run = promisify(execFile);
const temporaryDirectories: string[] = [];
afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    if (path.dirname(directory) !== path.resolve(os.tmpdir()) || !path.basename(directory).startsWith("max-workspace-rehearsal-"))
      throw new Error("Unexpected temporary directory.");
    await rm(directory, { recursive: true, force: true });
  }
});

it("rehearses only a verified backup, preserves originals, and refuses overwrite/overlap/corruption", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "max-workspace-rehearsal-"));
  temporaryDirectories.push(root);
  const { db, as } = setup();
  await as("local")("pages.create", { title: "English العربية", markdown: "# Stable IDs\n\nPrivate notes" });
  const original = db.snapshot();
  // A stopped synthetic local instance. No files are registered in this fixture.
  const source = path.join(root, "source");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(source);
  await writeFile(path.join(source, "db.json"), original);
  const backup = path.join(root, "backup");
  await run(process.execPath, ["scripts/local-backup.mjs", "create", "--source", source, "--destination", backup, "--stopped"]);
  const destination = path.join(root, "rehearsal");
  const command = ["--import", "tsx", "scripts/workspace-rehearsal.mjs", "plan", "--backup", backup, "--destination", destination];
  const result = await run(process.execPath, command);
  expect(result.stdout).toContain("Exact rollback verified");
  expect(result.stdout).not.toContain("Private notes");
  expect(await readFile(path.join(source, "db.json"), "utf8")).toBe(original);
  expect(await readFile(path.join(backup, "data", "db.json"), "utf8")).toBe(original);
  expect(await readFile(path.join(destination, "rollback.json"), "utf8")).toBe(original);
  const artifact = path.join(destination, "artifact.json");
  expect(JSON.parse(await readFile(path.join(destination, "expanded.json"), "utf8")).workspaces).toHaveLength(1);
  await run(process.execPath, ["--import", "tsx", "scripts/workspace-rehearsal.mjs", "verify", "--artifact", artifact]);
  await expect(run(process.execPath, command)).rejects.toThrow();
  await expect(run(process.execPath, [...command.slice(0, -1), path.join(backup, "inside")])).rejects.toThrow("must not overlap");
  await writeFile(path.join(backup, "data", "db.json"), original + " ");
  await expect(run(process.execPath, [...command.slice(0, -1), path.join(root, "corrupt")])).rejects.toThrow("checksum");
}, 30_000);

it("rehearses a verified version two backup with pending upload bytes and exact rollback", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "max-workspace-rehearsal-"));
  temporaryDirectories.push(root);
  const { db, as } = setup();
  await as("local")("pages.create", { title: "Personal" });
  const bytes = Buffer.from("pending upload bytes");
  await db.insert("uploadReceipts", {
    id: "pending-logical",
    ownerId: "upload-only-owner",
    capabilityHash: "d".repeat(64),
    createdAt: 0,
    expiresAt: 100,
    state: "stored",
    receivedByAttemptId: "receiver",
    storedAt: 1,
    registerUntil: 1000,
    blob: { storageId: "pendingfile01", type: "text/plain", size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") },
  });
  const original = db.snapshot();
  const source = path.join(root, "source");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(path.join(source, "files"), { recursive: true });
  await writeFile(path.join(source, "db.json"), original);
  await writeFile(path.join(source, "files", "pendingfile01"), bytes);
  await writeFile(path.join(source, "files", "pendingfile01.type"), "text/plain");
  const backup = path.join(root, "backup");
  await run(process.execPath, ["scripts/local-backup.mjs", "create", "--source", source, "--destination", backup, "--stopped"]);
  expect(JSON.parse(await readFile(path.join(backup, "manifest.json"), "utf8")).version).toBe(2);
  const destination = path.join(root, "rehearsal");
  await run(process.execPath, ["--import", "tsx", "scripts/workspace-rehearsal.mjs", "plan", "--backup", backup, "--destination", destination]);
  expect(await readFile(path.join(destination, "rollback.json"), "utf8")).toBe(original);
  const expanded = JSON.parse(await readFile(path.join(destination, "expanded.json"), "utf8"));
  expect(expanded.version).toBe(2);
  expect(expanded.tables.uploadReceipts).toEqual(JSON.parse(original).uploadReceipts);
  expect(expanded.workspaces).toHaveLength(2);
  const artifact = path.join(destination, "artifact.json");
  await run(process.execPath, ["--import", "tsx", "scripts/workspace-rehearsal.mjs", "verify", "--artifact", artifact]);
  expect(await readFile(path.join(backup, "data", "files", "pendingfile01"))).toEqual(bytes);
}, 30_000);
