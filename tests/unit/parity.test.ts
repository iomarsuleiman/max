import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { listOps, registry } from "@/lib/domain/ops";

/** Every operation the UI performs must exist in the shared registry, and be available over MCP unless it's credential/account management. */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? sources(p) : /\.(tsx?|ts)$/.test(f) ? [p] : [];
  });
}

describe("UI ↔ MCP parity", () => {
  const root = path.resolve(__dirname, "../..");
  const files = [...sources(path.join(root, "components")), ...sources(path.join(root, "app"))];
  const used = new Set<string>();
  for (const f of files) {
    const text = readFileSync(f, "utf8");
    for (const m of text.matchAll(/(?:call|read|useOp|prefetchOp)(?:<[^>]*>)?\(\s*"([a-zA-Z]+\.[a-zA-Z]+)"/g)) used.add(m[1]);
  }

  it("finds the UI's operations", () => {
    expect(used.size).toBeGreaterThan(40);
  });

  it("every UI operation is a registered domain operation", () => {
    const missing = [...used].filter((op) => !registry.has(op));
    expect(missing).toEqual([]);
  });

  it("every UI operation is exposed to MCP clients, except credential and account management", () => {
    const uiOnly = [...used].filter((op) => registry.get(op)?.uiOnly).sort();
    expect(uiOnly).toEqual(["account.deleteAllData", "audit.list", "tokens.create", "tokens.list", "tokens.revoke"]);
  });

  it("every operation has a description and input schema; destructive ones require confirm", () => {
    for (const op of listOps()) {
      expect(op.description.length, op.name).toBeGreaterThan(20);
      expect(op.input, op.name).toBeTruthy();
      if (op.destructive) expect(Object.keys((op.input as any).shape), op.name).toContain("confirm");
    }
  });
});
