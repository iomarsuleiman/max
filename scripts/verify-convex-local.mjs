import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { lstat, mkdtemp, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const uploadProof = process.argv[2] === "--uploads";
if (process.argv.length > (uploadProof ? 3 : 2)) throw new Error("Usage: verify-convex-local.mjs [--uploads]");
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
      uploadProof ? "enable" : "disable",
      "--env-file",
      envFile,
      "--run",
      uploadProof ? "uploadChecks:probeHttp" : "collaborationChecks:probeStorage",
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
  if (uploadProof ? !(/exactLimitPassed["']?\s*:\s*true/.test(combined) && /bytes["']?\s*:\s*52429824/.test(combined) && /cleaned["']?\s*:\s*2/.test(combined)) : !/checkedIndexes["']?\s*:\s*23/.test(combined))
    throw new Error("The local probe did not report its expected verification result.");
  await writeFile(
    path.join(artifacts, "report.json"),
    JSON.stringify(
      { localAnonymousDeploymentOnly: true, typecheckEnabled: true, schemaAndFunctionsPushed: true,
        ...(uploadProof ? { checkedUploadBytes: 52428800 } : { checkedIndexes: 23 }), productionModified: false },
      null,
      2,
    ),
  );
  console.log(`Verified local schema, functions and ${uploadProof ? "the 50 MiB HTTP upload path" : "23 storage index paths"}. Report: ${path.join(artifacts, "report.json")}`);
} catch (error) {
  // CLI failures may include env/identity metadata; keep terminal output bounded.
  await writeFile(path.join(artifacts, "private-cli-error.log"), [error?.stdout ?? "", error?.stderr ?? "", error?.message ?? ""].join("\n"));
  throw new Error(`Isolated Convex verification failed. Private diagnostics: ${path.join(artifacts, "private-cli-error.log")}`);
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
