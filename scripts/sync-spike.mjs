#!/usr/bin/env node
/** Isolated phase-04 experiment. Installs nothing and never opens Max data. */
import { createRequire } from "node:module";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const depsIndex = process.argv.indexOf("--deps");
if (depsIndex < 0 || !process.argv[depsIndex + 1]) throw new Error("Usage: node scripts/sync-spike.mjs --deps <isolated npm package directory>");
const dependencyRoot = path.resolve(process.argv[depsIndex + 1]);
if (dependencyRoot === root || dependencyRoot.startsWith(root + path.sep)) throw new Error("Spike dependencies must be outside the repository.");
const workspaceRequire = createRequire(path.join(root, "package.json"));
const isolatedRequire = createRequire(path.join(dependencyRoot, "package.json"));
const versions = {};
for (const name of [
  "yjs",
  "y-prosemirror",
  "y-protocols",
  "prosemirror-collab",
  "happy-dom",
  "@convex-dev/prosemirror-sync",
  "@y/y",
  "@y/prosemirror",
  "@y/protocols",
]) {
  const metadata = JSON.parse(await readFile(path.join(dependencyRoot, "node_modules", name, "package.json"), "utf8"));
  versions[name] = metadata.version;
}
versions["@blocknote/core"] = JSON.parse(await readFile(path.join(root, "node_modules/@blocknote/core/package.json"), "utf8")).version;
const coreRequire = createRequire(workspaceRequire.resolve("@blocknote/core"));
const pmRequire = createRequire(coreRequire.resolve("@tiptap/pm/state"));
const nextYRequire = createRequire(isolatedRequire.resolve("@y/prosemirror"));
const esbuildRequire = createRequire(workspaceRequire.resolve("tsx"));
const { build } = esbuildRequire("esbuild");
const { Window } = await import(pathToFileURL(isolatedRequire.resolve("happy-dom")).href);
const window = new Window({ url: "https://sync-spike.invalid/" });
for (const key of [
  "window",
  "document",
  "navigator",
  "Node",
  "Element",
  "HTMLElement",
  "MutationObserver",
  "DOMParser",
  "Text",
  "DocumentFragment",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
]) {
  const value = key === "window" ? window : window[key];
  Object.defineProperty(globalThis, key, { configurable: true, value: typeof value === "function" && /^[a-z]/.test(key) ? value.bind(window) : value });
}

const output = await mkdtemp(path.join(tmpdir(), "max-sync-proof-"));
const bundlePath = path.join(output, "experiment.cjs");
await build({
  absWorkingDir: root,
  entryPoints: ["scripts/sync-spike-experiment.mjs"],
  outfile: bundlePath,
  bundle: true,
  platform: "node",
  format: "cjs",
  loader: { ".css": "empty" },
  logLevel: "error",
  tsconfig: path.join(root, "tsconfig.json"),
  nodePaths: [path.join(root, "node_modules"), path.join(dependencyRoot, "node_modules")],
  plugins: [
    {
      name: "isolated-collaboration-peers",
      setup(builder) {
        builder.onResolve({ filter: /^(yjs|y-prosemirror|y-protocols)(\/|$)/ }, (args) => ({ path: isolatedRequire.resolve(args.path) }));
        builder.onResolve({ filter: /^@y\// }, (args) => ({ path: isolatedRequire.resolve(args.path) }));
        builder.onResolve({ filter: /^lib0(\/|$)/ }, (args) => {
          if (/[\\/]core[\\/]dist[\\/]y\.|[\\/]src[\\/]y[\\/]/.test(args.importer)) return { path: nextYRequire.resolve(args.path) };
          return undefined;
        });
        builder.onResolve({ filter: /^@tiptap\/pm\// }, (args) => ({ path: coreRequire.resolve(args.path) }));
        builder.onResolve({ filter: /^prosemirror-(model|state|view|transform|history)$/ }, (args) => ({ path: pmRequire.resolve(args.path) }));
        builder.onResolve({ filter: /^prosemirror-collab$/ }, () => ({ path: isolatedRequire.resolve("prosemirror-collab") }));
      },
    },
  ],
});
const corpus = JSON.parse(await readFile(path.join(root, "tests/fixtures/editor-document.json"), "utf8"));
try {
  const journalPath = path.join(output, "journal.json");
  const experiment = await workspaceRequire(bundlePath).runExperiment(corpus, {
    write: async (journal) => writeFile(journalPath, JSON.stringify(journal)),
    read: async () => JSON.parse(await readFile(journalPath, "utf8")),
  });
  const inputSha256 = {};
  for (const input of ["components/editor/blocks.tsx", "tests/fixtures/editor-document.json", "pnpm-lock.yaml"]) {
    inputSha256[input] = createHash("sha256")
      .update(await readFile(path.join(root, input)))
      .digest("hex");
  }
  const result = { ...experiment, versions, inputSha256 };
  await writeFile(path.join(output, "report.json"), JSON.stringify(result, null, 2) + "\n");
  process.stdout.write(JSON.stringify({ ...result, reportPath: path.join(output, "report.json") }, null, 2) + "\n");
} finally {
  await window.happyDOM.close();
}
