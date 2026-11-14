import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { verifyBackup } from "./local-backup.mjs";
import {
  applyWorkspaceMigration,
  planPersonalWorkspaceMigration,
  rollbackWorkspaceMigration,
  verifyWorkspaceMigrationPlan,
} from "../lib/domain/collaboration/migration.ts";

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      backup: { type: "string" },
      destination: { type: "string" },
      artifact: { type: "string" },
    },
  });
  const [command] = positionals;
  if (command === "verify" && positionals.length === 1 && values.artifact && !values.backup && !values.destination) {
    const plan = await verifyWorkspaceMigrationPlan(JSON.parse(await readFile(values.artifact, "utf8")));
    process.stdout.write(`Verified reversible rehearsal for ${plan.mappings.length} personal workspaces.\n`);
    return;
  }
  if (command !== "plan" || !values.backup || !values.destination || values.artifact || positionals.length !== 1) {
    throw new Error("Usage: tsx scripts/workspace-rehearsal.mjs plan --backup VERIFIED_BACKUP --destination NEW_DIR | verify --artifact FILE");
  }
  const stat = await lstat(values.backup);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Backup must be a regular directory.");
  const backup = await realpath(values.backup);
  await verifyBackup(backup);
  const original = await readFile(path.join(backup, "data", "db.json"), "utf8");
  const plan = await planPersonalWorkspaceMigration(original);
  const expanded = await applyWorkspaceMigration(original, plan);
  const restored = await rollbackWorkspaceMigration(expanded, plan);
  if (restored !== original) throw new Error("Exact rollback verification failed.");
  const input = path.resolve(values.destination);
  const destination = path.join(await realpath(path.dirname(input)), path.basename(input));
  const normalize = (value) => (process.platform === "win32" ? value.toLowerCase() : value);
  const a = normalize(backup);
  const b = normalize(destination);
  if (a === b || a.startsWith(b + path.sep) || b.startsWith(a + path.sep)) throw new Error("Backup and rehearsal destinations must not overlap.");
  // Claim exclusively. Rehearsal outputs are private and never overwrite files.
  await mkdir(destination, { mode: 0o700 });
  await writeFile(path.join(destination, "expanded.json"), expanded, { flag: "wx", mode: 0o600 });
  await writeFile(path.join(destination, "rollback.json"), restored, { flag: "wx", mode: 0o600 });
  await verifyBackup(backup);
  // Write last. A partial destination has no verified artifact.
  await writeFile(path.join(destination, "artifact.json"), JSON.stringify(plan, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  process.stdout.write(
    `Rehearsed ${plan.mappings.length} personal workspaces and ${Object.values(plan.counts).reduce((sum, count) => sum + count, 0)} rows. Exact rollback verified. No live data changed.\n`,
  );
}

main().catch((error) => {
  // Parsing errors can include source values; report a short operation failure only.
  process.stderr.write(
    `Workspace rehearsal failed: ${error instanceof SyntaxError ? "Invalid JSON." : error instanceof Error && error.name !== "ZodError" ? error.message : "Invalid source or artifact format."}\n`,
  );
  process.exitCode = 1;
});
