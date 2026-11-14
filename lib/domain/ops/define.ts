import { z } from "zod";
import type { Db, Storage } from "../db";
import type { Source } from "../types";
import type { NewRow } from "../db";

export interface OpContext {
  db: Db;
  storage: Storage | null;
  ownerId: string;
  now: number;
  source: Source;
  /** Trusted upload receipt consumption, in the same transaction as the asset insert. */
  registerUpload?: (asset: NewRow<"assets">) => Promise<string>;
  preflightUploadDeletion?: () => Promise<void>;
  deleteUploads?: () => Promise<void>;
  deleteConnectedAccountData?: () => Promise<void>;
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
