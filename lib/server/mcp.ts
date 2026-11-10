import "server-only";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { APP_URL, VERSION } from "@/lib/config";
import { serializeError } from "@/lib/domain/errors";
import { listOps } from "@/lib/domain/ops";
import { LIMITS } from "@/lib/domain/ops/helpers";
import { runForOwner } from "./executor";
import { importHtml, uploadAsset } from "./mcpExtras";
import { NOTION_MCP_TOOLS } from "@/lib/notion/tools";

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

const IDEMPOTENCY = z
  .string()
  .min(8)
  .max(200)
  .optional()
  .describe("Optional unique key. Repeating a call with the same key within 24 hours returns the first result instead of applying it again.");

function toolResult(result: unknown) {
  const structured = (result && typeof result === "object" && !Array.isArray(result) ? result : { result }) as Record<string, unknown>;
  return { content: [{ type: "text" as const, text: JSON.stringify(result) }], structuredContent: structured };
}
function toolError(err: unknown) {
  return { isError: true, content: [{ type: "text" as const, text: JSON.stringify({ error: serializeError(err) }) }] };
}

/** Extra tools composed from domain operations (they need the server's network or Node APIs). */
export const EXTRA_TOOLS = ["assets_upload", "import_html", "max_capabilities", "profileCard_exportPng", ...NOTION_MCP_TOOLS.map((tool) => tool.name)];

export function createMcpServer(ownerId: string) {
  const server = new McpServer({ name: "max", version: VERSION, title: "Max", websiteUrl: APP_URL }, { instructions: INSTRUCTIONS });
  server.registerTool(
    "profileCard_exportPng",
    {
      title: "Download my workspace card as PNG",
      description:
        "Renders your saved private card as a PNG image using Max's shared card artwork. Returns the image directly without publishing or sending it to an external service.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      try {
        const exported = (await runForOwner(ownerId, "profileCard.export", {})) as { svg: string; width: number; height: number };
        const { default: sharp } = await import("sharp");
        const png = await sharp(Buffer.from(exported.svg), { density: 216 }).png().toBuffer();
        return {
          content: [{ type: "image" as const, data: png.toString("base64"), mimeType: "image/png" }],
          structuredContent: { filename: "max-workspace-card.png", mimeType: "image/png", width: exported.width * 3, height: exported.height * 3 },
        };
      } catch (err) {
        return toolError(err);
      }
    },
  );
  for (const tool of NOTION_MCP_TOOLS) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.input,
        annotations: {
          readOnlyHint: tool.readOnly,
          destructiveHint: false,
          idempotentHint: tool.readOnly || tool.operation === "start" || tool.operation === "cancel",
          openWorldHint: true,
        },
      },
      async (args: unknown) => {
        try {
          const { runNotionForOwner } = await import("./notion");
          return toolResult(await runNotionForOwner(ownerId, tool.operation, tool.input.parse(args)));
        } catch (err) {
          return toolError(err);
        }
      },
    );
  }
  for (const op of mcpTools()) {
    server.registerTool(
      toolName(op.name),
      {
        title: op.title,
        description: op.description,
        // Writes accept an idempotency key so a retried call isn't applied twice.
        inputSchema: op.kind === "mutation" ? (op.input as z.ZodObject).extend({ idempotencyKey: IDEMPOTENCY }) : (op.input as z.ZodObject),
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
          return toolResult(await runForOwner(ownerId, op.name, args));
        } catch (err) {
          return toolError(err);
        }
      }) as never,
    );
  }
  server.registerTool(
    "assets_upload",
    {
      title: "Upload an image",
      description:
        "Stores an image from a public https URL or base64 data (PNG, JPEG, WebP, GIF, AVIF or SVG, up to 20 MB) and returns a max-asset:// URL to use in an image block's url prop or as a page cover.",
      inputSchema: z.object({
        url: z.string().url().optional(),
        base64: z.string().max(28_000_000).optional(),
        name: z.string().max(200).optional(),
        pageId: z.string().max(64).nullable().optional(),
        alt: z.string().max(500).optional(),
      }),
      annotations: { title: "Upload an image", readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    (async (args: Parameters<typeof uploadAsset>[1]) => {
      try {
        return toolResult(await uploadAsset(ownerId, args));
      } catch (err) {
        return toolError(err);
      }
    }) as never,
  );
  server.registerTool(
    "import_html",
    {
      title: "Import HTML as a page",
      description:
        "Creates a page from HTML you pass, or from a public https web page. The HTML is converted to blocks; scripts, styles and embeds are dropped.",
      inputSchema: z.object({
        html: z.string().max(2_000_000).optional(),
        url: z.string().url().optional(),
        title: z.string().max(500).optional(),
        parentId: z.string().max(64).nullable().optional(),
      }),
      annotations: { title: "Import HTML", readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    (async (args: Parameters<typeof importHtml>[1]) => {
      try {
        return toolResult(await importHtml(ownerId, args));
      } catch (err) {
        return toolError(err);
      }
    }) as never,
  );

  // Pages as readable resources: max://page/{id} returns Markdown.
  server.registerResource(
    "page",
    new ResourceTemplate("max://page/{id}", {
      list: async () => {
        const recent = (await runForOwner(ownerId, "pages.recents", { limit: 25 })) as { pages: { _id: string; title: string }[] };
        return { resources: recent.pages.map((p) => ({ uri: `max://page/${p._id}`, name: p.title || "Untitled", mimeType: "text/markdown" })) };
      },
    }),
    { title: "Max page", description: "A page's content as Markdown.", mimeType: "text/markdown" },
    async (uri, { id }) => {
      const doc = (await runForOwner(ownerId, "documents.get", { pageId: String(id), format: "markdown" })) as { title: string; markdown: string };
      return { contents: [{ uri: uri.href, mimeType: "text/markdown", text: `# ${doc.title || "Untitled"}\n\n${doc.markdown}` }] };
    },
  );

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
        tools: [
          ...mcpTools().map((op) => ({
            name: toolName(op.name),
            kind: op.kind === "query" ? "read" : "write",
            needsConfirm: !!op.destructive,
            title: op.title,
          })),
          { name: "assets_upload", kind: "write", needsConfirm: false, title: "Upload an image" },
          { name: "import_html", kind: "write", needsConfirm: false, title: "Import HTML as a page" },
          { name: "max_capabilities", kind: "read", needsConfirm: false, title: "What Max can do" },
          { name: "profileCard_exportPng", kind: "read", needsConfirm: false, title: "Download my workspace card as PNG" },
          ...NOTION_MCP_TOOLS.map((tool) => ({ name: tool.name, kind: tool.readOnly ? "read" : "write", needsConfirm: false, title: tool.title })),
        ],
        resources: ["max://page/{id} (Markdown)"],
        idempotency: "Write tools accept idempotencyKey; repeats within 24 hours return the first result.",
        limits: LIMITS,
        notAvailable: ["Access tokens and account deletion (manage in Max settings)", "Real-time collaboration or sharing (Max is a private workspace)"],
        errors: ["UNAUTHENTICATED", "NOT_FOUND", "VALIDATION", "CONFLICT", "LIMIT", "CONFIRMATION_REQUIRED", "READ_ONLY", "INTERNAL"],
      };
      return { content: [{ type: "text" as const, text: JSON.stringify(data) }], structuredContent: data };
    },
  );
  return server;
}
