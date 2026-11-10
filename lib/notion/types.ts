import { z } from "zod";

export const sourceId = z.string().regex(/^[a-f0-9-]{32,36}$/i);
export const selectionSchema = z.object({
  sourceIds: z.array(sourceId).min(1).max(50),
  parentId: z.string().min(1).max(64).nullable().default(null),
  includeDescendants: z.boolean().default(true),
});
export const startSchema = selectionSchema.extend({ idempotencyKey: z.string().min(8).max(200) });
export const jobIdSchema = z.object({ jobId: z.string().min(1).max(64) });
export const sourceSchema = z.object({ id: sourceId, title: z.string(), kind: z.enum(["page", "data_source", "database"]), url: z.string() });
export type NotionSource = z.infer<typeof sourceSchema>;
export const taskSchema = z.object({
  sourceId,
  kind: z.enum(["page", "data_source", "database", "rows", "repair"]),
  parentSourceId: z.string().nullable(),
  parentId: z.string().nullable(),
  databaseId: z.string().nullable(),
  cursor: z.string().nullable().default(null),
  depth: z.number().int().min(0).max(40).default(0),
});
export type ImportTask = z.infer<typeof taskSchema>;
export const jobStatus = z.enum(["queued", "running", "completed", "completed_with_warnings", "failed", "cancelled"]);
export interface ImportWarning {
  sourceId: string;
  message: string;
}
export const NOTION_VERSION = "2026-03-11";
export const IMPORT_LIMITS = { items: 2000, blocksPerPage: 1000, bytesPerAsset: 10 * 1024 * 1024, depth: 35 };
export const objectSchema = z.record(z.string(), z.unknown());
export function object(value: unknown): Record<string, unknown> {
  return objectSchema.parse(value);
}
export function objects(value: unknown): Record<string, unknown>[] {
  return z.array(objectSchema).parse(value);
}
export function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}
export function richText(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value
    .map((v) => {
      const r = object(v);
      return text(r.plain_text) || (r.text ? text(object(r.text).content) : "");
    })
    .join("");
}
export function sourceFrom(value: unknown): NotionSource {
  const o = object(value);
  const properties = o.properties ? object(o.properties) : {};
  const titleProperty = Object.values(properties)
    .map(object)
    .find((p) => p.type === "title");
  const kind = o.object === "data_source" ? "data_source" : o.object === "database" ? "database" : "page";
  return sourceSchema.parse({
    id: o.id,
    kind,
    title: richText(o.title) || richText(titleProperty?.title) || "Untitled",
    url: text(o.url) || `https://www.notion.so/${text(o.id).replaceAll("-", "")}`,
  });
}
