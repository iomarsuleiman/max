import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { lstat, mkdtemp, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envFile = path.join(root, ".env.convex-verification.local");
const generated = path.join(root, ".env.local");
const selector = await readFile(envFile, "utf8");
if (!/^CONVEX_DEPLOYMENT=anonymous:[^\r\n]+/m.test(selector)) throw new Error("Refusing a verification environment that does not select anonymous local mode.");
const selectorKeys = [...selector.matchAll(/^([A-Z_]+)=/gm)].map((match) => match[1]);
if (selectorKeys.some((key) => !["CONVEX_DEPLOYMENT", "NEXT_PUBLIC_CONVEX_URL", "NEXT_PUBLIC_CONVEX_SITE_URL"].includes(key)))
  throw new Error("The verification env contains unsupported overrides.");
const verificationEnvironment = { ...process.env, CONVEX_AGENT_MODE: "anonymous" };
for (const key of [
  "CONVEX_DEPLOY_KEY",
  "CONVEX_DEPLOYMENT",
  "CONVEX_SELF_HOSTED_URL",
  "CONVEX_SELF_HOSTED_ADMIN_KEY",
  "NEXT_PUBLIC_CONVEX_URL",
  "NEXT_PUBLIC_CONVEX_SITE_URL",
])
  delete verificationEnvironment[key];
try {
  await lstat(generated);
  throw new Error("Preserve the existing .env.local before running isolated verification.");
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}
const artifacts = await mkdtemp(path.join(os.tmpdir(), "max-convex-local-proof-"));
try {
  const result = await promisify(execFile)(
    process.execPath,
    [
      path.join(root, "node_modules/convex/bin/main.js"),
      "dev",
      "--once",
      "--typecheck",
      "enable",
      "--codegen",
      "disable",
      "--env-file",
      envFile,
      "--run",
      "collaborationChecks:probeStorage",
    ],
    {
      cwd: root,
      windowsHide: true,
      timeout: 180_000,
      maxBuffer: 4 * 1024 * 1024,
      env: verificationEnvironment,
    },
  );
  const combined = result.stdout + result.stderr;
  if (!/checkedIndexes["']?\s*:\s*18/.test(combined)) throw new Error("The local storage probe did not report all expected indexes.");
  await writeFile(
    path.join(artifacts, "report.json"),
    JSON.stringify(
      { localAnonymousDeploymentOnly: true, typecheckEnabled: true, schemaAndFunctionsPushed: true, checkedIndexes: 18, productionModified: false },
      null,
      2,
    ),
  );
  console.log(`Verified local schema, functions and 18 storage index paths. Report: ${path.join(artifacts, "report.json")}`);
} catch {
  // CLI failures may include env/identity metadata; keep terminal output bounded.
  throw new Error("Isolated Convex verification failed. Run pnpm typecheck, then inspect the anonymous local deployment.");
} finally {
  try {
    const contents = await readFile(generated, "utf8");
    const keys = [...contents.matchAll(/^([A-Z_]+)=/gm)].map((match) => match[1]);
    const expected = new Set(["CONVEX_DEPLOYMENT", "NEXT_PUBLIC_CONVEX_URL", "NEXT_PUBLIC_CONVEX_SITE_URL"]);
    if (!keys.length || keys.some((key) => !expected.has(key)) || !/^NEXT_PUBLIC_CONVEX_URL=http:\/\/127\.0\.0\.1:/m.test(contents))
      throw new Error("Unexpected generated env content; it has been retained for review.");
    // Preserve the generated verification config outside the app, rather than
    // letting a schema check silently switch the next app build to cloud mode.
    await rename(generated, path.join(artifacts, "generated.env"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}
