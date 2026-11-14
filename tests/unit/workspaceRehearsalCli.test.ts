import { execFile } from "node:child_process";
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
