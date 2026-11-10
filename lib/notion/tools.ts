import { z } from "zod";
import { selectionSchema, startSchema, jobIdSchema } from "./types";

/** The UI and MCP use the same connector service. Credentials and consent remain UI-owned. */
export const NOTION_MCP_TOOLS = [
  {
    operation: "status",
    name: "notion_status",
    title: "Get Notion connection status",
    readOnly: true,
    description: "Returns safe connection metadata for your own Notion workspace. Connect or reconnect in Max Settings; no provider credential is returned.",
    input: z.object({}),
  },
  {
    operation: "sources",
    name: "notion_sources",
    title: "List shared Notion sources",
    readOnly: true,
    description:
      "Searches pages and data sources shared with your connected Notion integration. Follow nextCursor for more results; this is not the entire Notion workspace.",
    input: z.object({ query: z.string().max(200).optional(), cursor: z.string().max(200).optional() }),
  },
  {
    operation: "preview",
    name: "notion_preview",
    title: "Preview a Notion import",
    readOnly: true,
    description:
      "Reviews selected authorized Notion roots and a Max destination before importing copies. Estimates and known limitations are disclosed; source content is never modified.",
    input: selectionSchema,
  },
  {
    operation: "start",
    name: "notion_start",
    title: "Import copies from Notion",
    readOnly: false,
    description:
      "Starts a persisted background import of selected shared Notion pages and databases into your Max workspace. Supply a stable idempotencyKey to retry without duplicate trees. This never changes Notion originals.",
    input: startSchema,
  },
  {
    operation: "job",
    name: "notion_job",
    title: "Get Notion import progress",
    readOnly: true,
    description: "Returns persisted progress, counts, warnings and errors for an import owned by your Max account. Use rootIds to open imported copies.",
    input: jobIdSchema,
  },
  {
    operation: "report",
    name: "notion_report",
    title: "Read a Notion import report",
    readOnly: true,
    description:
      "Returns the owner-scoped migration report with created, skipped and failed items and conversion warnings. Never contains upstream access tokens.",
    input: jobIdSchema,
  },
  {
    operation: "history",
    name: "notion_history",
    title: "List Notion import history",
    readOnly: true,
    description: "Lists recent Notion import jobs owned by your Max account, including completed, interrupted and failed imports.",
    input: z.object({}),
  },
  {
    operation: "cancel",
    name: "notion_cancel",
    title: "Cancel a Notion import",
    readOnly: false,
    description:
      "Stops an owned background import at its next checkpoint. Already imported Max copies remain and the original Notion content is never changed.",
    input: jobIdSchema,
  },
  {
    operation: "retry",
    name: "notion_retry",
    title: "Resume an incomplete Notion import",
    readOnly: false,
    description:
      "Resumes an owned interrupted import from persisted checkpoints without duplicating previously created copies. Reconnect in Max if source access expired.",
    input: jobIdSchema,
  },
] as const;
