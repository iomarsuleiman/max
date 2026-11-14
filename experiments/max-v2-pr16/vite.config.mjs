import { defineConfig } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const labDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(labDirectory, "../..");

/**
 * This is not a Max app route. The only bundled entrypoint is an isolated
 * synthetic fixture under experiments/. No Clerk, Convex, personal data or
 * deployment scripts are loaded.
 */
export default defineConfig({
  root: labDirectory,
  resolve: {
    alias: [{ find: /^@\//, replacement: repositoryRoot + "/" }],
    dedupe: [
      "react", "react-dom", "yjs", "y-prosemirror",
      "@blocknote/core", "@blocknote/react", "@blocknote/shadcn",
      "@blocknote/xl-multi-column",
    ],
  },
  esbuild: { jsx: "automatic" },
  server: {
    host: "127.0.0.1",
    port: 3236,
    strictPort: true,
    fs: { allow: [repositoryRoot] },
  },
  preview: { host: "127.0.0.1", port: 3236, strictPort: true },
});
