import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { createBackup, restoreBackup, verifyBackup } from "../../scripts/local-backup.mjs";

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "max-backup-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
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
