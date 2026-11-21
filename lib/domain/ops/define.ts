import { z } from "zod";
import type { Db, Storage } from "../db";
import type { PageRow, Source } from "../types";

export interface OpContext {
  db: Db;
  storage: Storage | null;
  ownerId: string;
  now: number;
  source: Source;
  /** Who is acting when it isn't the owner (someone the page is shared with). */
  actor?: { id: string; name: string; image: string | null };
  /** Set when ownerId is an organization: the caller's verified role there (lib/domain/organizations.ts). */
  org?: { role: import("../types").OrgRole };
  /**
   * The unfiltered database when ctx.db hides private pages from this member (orgGate). Only for
   * name-only listings of closed teamspaces; never return content read through it.
   */
  unrestrictedDb?: Db;
  /** Max's platform admin, from the verified sign-in (set only by trusted transports). */
  platformAdmin?: boolean;
  /** Calls from a connected app (source "app"): the permissions its installation was granted. */
  appScopes?: readonly string[];
  /** Set by transports that deliver webhooks: execute() counts deliveries queued by this call. */
  outbox?: { queued: number };
  /** The call came through a page share (lib/domain/sharing.ts), already checked against the share. */
  viaShare?: boolean;
  /** A published site's page boundary, supplied by the trusted site reader. */
  publishedPages?: ReadonlyMap<string, PageRow>;
}

export interface OpDef<I extends z.ZodType = z.ZodType, O = unknown> {
  name: string;
  kind: "query" | "mutation";
  title: string;
  description: string;
  /** Permanently removes data; callers must pass `confirm: true` after showing the consequences. */
  destructive?: boolean;
  /** Not exposed over MCP (credential and account management). Documented in docs/MCP.md. */
  uiOnly?: boolean;
  input: I;
  run: (ctx: OpContext, input: z.infer<I>) => Promise<O>;
}

export function defineOp<I extends z.ZodType, O>(def: OpDef<I, O>): OpDef<I, O> {
  return def;
}

/* Shared schemas */
export const id = z.string().min(1).max(64).describe("Max id");
export const optionalId = id.nullable().optional();
export const confirm = z
  .boolean()
  .optional()
  .describe("Must be true. Confirms you have told the user this permanently removes data.");
export const title = z.string().max(500);
/** An emoji, "lucide:<name>:<color>", or an image: an uploaded "max-asset://<id>" or an https link. */
export const icon = z
  .string()
  .max(2048)
  .refine((v) => v.length <= 64 || /^(https:\/\/|max-asset:\/\/)/.test(v), "An icon is an emoji, an icon name, or an image link.")
  .nullable();
