import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.E2E_PORT ?? 3210);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("E2E_PORT must be an integer from 1024 to 65535.");
const output = path.join(root, "test-results", "server-data");
await mkdir(output, { recursive: true });
const dataDir = await mkdtemp(path.join(output, "workspace-"));
const env = { ...process.env, MAX_LOCAL_MODE: "true", MAX_DATA_DIR: dataDir, NEXT_PUBLIC_CONVEX_URL: "", NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "" };
const next = path.join(root, "node_modules", "next", "dist", "bin", "next");
let child;
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    stopping = true;
    child?.kill(signal);
  });
async function run(args) {
  return new Promise((resolve, reject) => {
    child = spawn(process.execPath, [next, ...args], { cwd: root, env, stdio: "inherit", windowsHide: true });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0 || stopping) resolve();
      else reject(new Error(`Next.js ${args[0]} exited with ${code}.`));
    });
  });
}
try {
  if (process.env.E2E_SKIP_BUILD === "true") await readFile(path.join(root, ".next", "BUILD_ID"));
  else await run(["build"]);
  if (!stopping) await run(["start", "--hostname", "127.0.0.1", "--port", String(port)]);
} catch (error) {
  console.error(error instanceof Error ? error.message : "E2E server failed.");
  process.exitCode = 1;
}
