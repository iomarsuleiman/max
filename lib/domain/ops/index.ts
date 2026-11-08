import { z } from "zod";
import { MaxError, serializeError } from "../errors";
import type { OpContext, OpDef } from "./define";
import { defineOp } from "./define";
import { LIMITS } from "./helpers";
import * as pages from "./pages";
import * as documents from "./documents";
import * as databases from "./databases";
import * as templates from "./templates";
import * as account from "./account";

const all: OpDef[] = [];
for (const mod of [pages, documents, databases, templates, account]) {
  for (const value of Object.values(mod)) {
    if (value && typeof value === "object" && "name" in value && "run" in value && "input" in value) all.push(value as OpDef);
  }
}

export const batch = defineOp({
  name: "batch",
  kind: "mutation",
  title: "Run several operations",
  description:
    "Runs up to 50 write operations in order as one transaction: if any fails, none are applied, and the error says which one failed. Each item is { op, args } using the same names and inputs as the individual tools.",
  input: z.object({ operations: z.array(z.object({ op: z.string(), args: z.record(z.string(), z.unknown()).optional() })).min(1).max(LIMITS.batchOperations) }),
  async run(ctx, { operations }) {
    const results: unknown[] = [];
    for (const [index, item] of operations.entries()) {
      const def = registry.get(item.op);
      if (!def || def.kind !== "mutation" || def.name === "batch") {
        throw new MaxError("VALIDATION", `Operation ${index + 1} ("${item.op}") isn't a write operation that can run in a batch.`, { failedIndex: index });
      }
      if (def.uiOnly && ctx.source === "mcp") throw new MaxError("VALIDATION", `"${item.op}" isn't available to assistants.`, { failedIndex: index });
      try {
        results.push(await runOp(def, item.args ?? {}, ctx));
      } catch (err) {
        const e = serializeError(err);
        throw new MaxError(e.code, `Operation ${index + 1} (${item.op}) failed: ${e.message} Nothing in this batch was applied.`, { ...e.details, failedIndex: index });
      }
    }
    return { results };
  },
});
all.push(batch as OpDef);

export const registry = new Map<string, OpDef>(all.map((op) => [op.name, op]));

export function listOps(): OpDef[] {
  return [...registry.values()].sort((a, b) => a.name.localeCompare(b.name));
}

async function runOp(def: OpDef, rawArgs: unknown, ctx: OpContext) {
  const parsed = def.input.safeParse(rawArgs ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new MaxError("VALIDATION", `Invalid ${issue.path.join(".") || "input"}: ${issue.message}`, { issues: parsed.error.issues.slice(0, 5) });
  }
  if (def.destructive && (parsed.data as { confirm?: boolean }).confirm !== true) {
    throw new MaxError("CONFIRMATION_REQUIRED", `${def.title} permanently removes data. Confirm with the user, then call again with confirm: true.`, { op: def.name });
  }
  return def.run(ctx, parsed.data);
}

function targetOf(args: unknown): string | null {
  const a = (args ?? {}) as Record<string, unknown>;
  const v = a.id ?? a.pageId ?? a.databaseId ?? a.templateId ?? null;
  return typeof v === "string" ? v : null;
}

/**
 * The single entry point for every operation, from the UI, Convex and MCP alike.
 * Validates input, enforces confirmations, and records assistant activity (never content).
 */
export async function execute(name: string, args: unknown, ctx: OpContext, expectKind?: "query" | "mutation") {
  const def = registry.get(name);
  if (!def) throw new MaxError("NOT_FOUND", `Unknown operation "${name}".`);
  if (expectKind && def.kind !== expectKind) throw new MaxError("VALIDATION", `"${name}" is a ${def.kind}, not a ${expectKind}.`);
  if (def.uiOnly && ctx.source === "mcp") throw new MaxError("VALIDATION", `"${name}" isn't available to assistants.`);
  const audit = ctx.source === "mcp" && def.kind === "mutation";
  // Writes may carry an idempotency key: a retry with the same key returns the first result.
  const raw = (args ?? {}) as Record<string, unknown>;
  const key = def.kind === "mutation" && typeof raw.idempotencyKey === "string" ? raw.idempotencyKey.slice(0, 200) : null;
  if (key) {
    const { idempotencyKey: _k, ...rest } = raw;
    args = rest;
    const seen = (await ctx.db.list("idempotency", ctx.ownerId, { field: "key", value: key }))[0];
    if (seen && ctx.now - seen.at < 24 * 3600_000) {
      if (seen.op !== name) throw new MaxError("VALIDATION", `That idempotency key was already used for ${seen.op}. Use a new key for a different operation.`);
      return { ...JSON.parse(seen.result), idempotentReplay: true };
    }
  }
  try {
    const result = await runOp(def, args, ctx);
    if (key) {
      for (const old of await ctx.db.list("idempotency", ctx.ownerId, { field: "key", value: key })) await ctx.db.delete("idempotency", old._id);
      await ctx.db.insert("idempotency", { ownerId: ctx.ownerId, key, op: name, result: JSON.stringify(result ?? null), at: ctx.now });
    }
    if (audit) await ctx.db.insert("audit", { ownerId: ctx.ownerId, op: name, source: ctx.source, targetId: targetOf(args), ok: true, code: null, at: ctx.now });
    return result;
  } catch (err) {
    // Failed mutations roll back, so failures are logged by the transport (see lib/server).
    throw err;
  }
}

export type { OpContext, OpDef };
