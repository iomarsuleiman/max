import "server-only";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { APP_URL, VERSION } from "@/lib/config";
import { serializeError } from "@/lib/domain/errors";
import { listOps } from "@/lib/domain/ops";
import { LIMITS } from "@/lib/domain/ops/helpers";
import { runForOwner } from "./executor";

/** MCP tool names use underscores: "pages.create" → "pages_create". */
export const toolName = (op: string) => op.replace(/\./g, "_");

export function mcpTools() {
  return listOps().filter((op) => !op.uiOnly);
}

const INSTRUCTIONS = `Max is the user's private notes workspace: nested pages, rich documents and personal databases.
- Start with pages_tree or search_query to find pages; documents_get returns content as blocks with stable ids (format "markdown" for reading).
- Edit content with blocks_* tools (by block id) or documents_writeMarkdown. Pass baseRevision from documents_get to avoid overwriting newer edits; on CONFLICT, read again.
- Databases: databases_get for properties and views, databases_query for rows, records_* to change rows. Values are keyed by property name or id.
- Templates: templates_list / templates_apply; gallery_list / gallery_install for built-in templates.
- Tools marked destructive need confirm: true, only after the user has agreed. Trashing (pages_archive) is reversible with pages_restore.
- Use batch for several writes that must all succeed together.`;

export function createMcpServer(ownerId: string) {
  const server = new McpServer({ name: "max", version: VERSION, title: "Max", websiteUrl: APP_URL }, { instructions: INSTRUCTIONS });
  for (const op of mcpTools()) {
    server.registerTool(
      toolName(op.name),
      {
        title: op.title,
        description: op.description,
        inputSchema: op.input as z.ZodObject,
        annotations: {
          title: op.title,
          readOnlyHint: op.kind === "query",
          destructiveHint: op.kind === "mutation" ? !!op.destructive || /archive|delete|remove/.test(op.name) : false,
          idempotentHint: op.kind === "query",
          openWorldHint: false,
        },
      },
      (async (args: unknown) => {
        try {
          const result = await runForOwner(ownerId, op.name, args);
          const structured = (result && typeof result === "object" && !Array.isArray(result) ? result : { result }) as Record<string, unknown>;
          return { content: [{ type: "text" as const, text: JSON.stringify(result) }], structuredContent: structured };
        } catch (err) {
          const error = serializeError(err);
          return { isError: true, content: [{ type: "text" as const, text: JSON.stringify({ error }) }] };
        }
      }) as never,
    );
  }
  server.registerTool(
    "max_capabilities",
    {
      title: "What Max can do",
      description: "Lists every Max tool with its kind (read or write), whether it needs confirm: true, and the workspace limits.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const data = {
        version: VERSION,
        tools: mcpTools().map((op) => ({ name: toolName(op.name), kind: op.kind === "query" ? "read" : "write", needsConfirm: !!op.destructive, title: op.title })),
        limits: LIMITS,
        notAvailable: ["Access tokens and account deletion (manage in Max settings)", "Real-time collaboration or sharing (Max is a private workspace)"],
        errors: ["UNAUTHENTICATED", "NOT_FOUND", "VALIDATION", "CONFLICT", "LIMIT", "CONFIRMATION_REQUIRED", "READ_ONLY", "INTERNAL"],
      };
      return { content: [{ type: "text" as const, text: JSON.stringify(data) }], structuredContent: data };
    },
  );
  return server;
}
