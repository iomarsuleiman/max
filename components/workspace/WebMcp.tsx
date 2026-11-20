"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { pageHref } from "@/lib/pageUrl";
import { switchWorkspace } from "@/lib/client/workspace";
import { useWorkspace } from "./context";
import { confirmAction } from "@/components/ui";

/**
 * WebMCP: lets an AI agent in the browser (one that supports `navigator.modelContext`) use Max
 * the way you do, as you: find and open pages, read and write them, create pages, switch
 * workspaces and run any Max operation. Nothing is exposed unless the browser offers the API,
 * and every call goes through the same permission checks as the app itself.
 */

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };
interface WebMcpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean };
  execute: (input: Record<string, unknown>) => Promise<ToolResult>;
}
interface ModelContext {
  registerTool?: (tool: WebMcpTool) => { unregister?: () => void } | void;
  unregisterTool?: (name: string) => void;
  provideContext?: (context: { tools: WebMcpTool[] }) => void;
  clearContext?: () => void;
}

/** Never available to a browser agent: account deletion, access tokens, workspace deletion, activity log. */
const BLOCKED = new Set(["account.deleteAllData", "tokens.create", "tokens.list", "tokens.revoke", "audit.list", "workspaces.delete", "account.setUsername"]);
/** Anything that removes or takes something down asks the person first, in Max's own dialog. */
const ASKS_FIRST = /(delete|archive|remove|revoke|unpublish|empty|deletePermanently|setLink|invite|leave)/i;

const text = (value: unknown): ToolResult => ({ content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] });
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required });

export function WebMcp() {
  const ws = useWorkspace();
  const router = useRouter();
  const pathname = usePathname();
  // Tools read the latest values without re-registering on every render.
  const live = useRef({ ws, router, pathname });
  live.current = { ws, router, pathname };

  useEffect(() => {
    const mc = (navigator as Navigator & { modelContext?: ModelContext }).modelContext;
    if (!mc) return;
    const call = <T,>(op: string, args: Record<string, unknown> = {}) => live.current.ws.call<T>(op, args);
    const currentPageId = () => /^\/p\/(?:.*-)?([a-z0-9]{16,})$/i.exec(live.current.pathname)?.[1] ?? null;
    const run = (fn: (input: Record<string, unknown>) => Promise<unknown>) => async (input: Record<string, unknown>) => {
      try {
        return text(await fn(input ?? {}));
      } catch (err) {
        return { ...text(err instanceof Error ? err.message : String(err)), isError: true };
      }
    };
    const tools: WebMcpTool[] = [
      {
        name: "max_search",
        description: "Search the open Max workspace for pages and databases by title and content.",
        inputSchema: obj({ query: { type: "string" } }, ["query"]),
        annotations: { readOnlyHint: true },
        execute: run(async ({ query }) => call("search.query", { query: String(query) })),
      },
      {
        name: "max_open",
        description: "Open a page in Max by its id, or by its title (the best match). Also opens Home, Templates, Graph or Trash by name.",
        inputSchema: obj({ page: { type: "string", description: "A page id or title, or home/templates/graph/trash." } }, ["page"]),
        execute: run(async ({ page }) => {
          const wanted = String(page).trim();
          const places: Record<string, string> = { home: "/home", templates: "/templates", graph: "/graph", trash: "/trash" };
          if (places[wanted.toLowerCase()]) return live.current.router.push(places[wanted.toLowerCase()]), `Opened ${wanted}.`;
          const byId = await call<{ page: { _id: string; title: string } }>("pages.get", { id: wanted }).catch(() => null);
          const hit = byId?.page ?? (await call<{ results: { _id: string; title: string }[] }>("search.query", { query: wanted, limit: 1 })).results?.[0];
          if (!hit) throw new Error(`No page matches “${wanted}”.`);
          live.current.router.push(pageHref(hit._id, hit.title));
          return `Opened “${hit.title || "Untitled"}”.`;
        }),
      },
      {
        name: "max_read_current_page",
        description: "Read the page that's open in Max right now, as Markdown.",
        inputSchema: obj({}),
        annotations: { readOnlyHint: true },
        execute: run(async () => {
          const id = currentPageId();
          if (!id) throw new Error("No page is open. Use max_open first.");
          return call("documents.get", { pageId: id, format: "markdown" });
        }),
      },
      {
        name: "max_create_page",
        description: "Create a page (optionally inside the open page) with a title and Markdown content, and open it.",
        inputSchema: obj({ title: { type: "string" }, markdown: { type: "string" }, insideCurrentPage: { type: "boolean" } }, ["title"]),
        execute: run(async ({ title, markdown, insideCurrentPage }) => {
          const { page } = await call<{ page: { _id: string; title: string } }>("pages.create", { title: String(title), ...(markdown ? { markdown: String(markdown) } : {}), ...(insideCurrentPage ? { parentId: currentPageId() } : {}) });
          live.current.router.push(pageHref(page._id, page.title));
          return `Created and opened “${page.title}”.`;
        }),
      },
      {
        name: "max_workspaces",
        description: "List the user's workspaces, or switch to one by id or name (null or “main” for the main workspace).",
        inputSchema: obj({ switchTo: { type: ["string", "null"] } }),
        execute: run(async ({ switchTo }) => {
          const { workspaces } = await call<{ workspaces: { id: string | null; name: string }[] }>("workspaces.list");
          if (switchTo === undefined) return workspaces;
          const key = String(switchTo ?? "main").toLowerCase();
          const hit = key === "main" || switchTo === null ? workspaces[0] : workspaces.find((w) => w.id === switchTo || w.name.toLowerCase() === key);
          if (!hit) throw new Error(`No workspace called “${switchTo}”.`);
          switchWorkspace(hit.id);
          return `Switching to ${hit.name}.`;
        }),
      },
      {
        name: "max_settings",
        description: "Open Max's settings at a section: workspace, account, preferences, editor, sidebar, sharing, connections, data, shortcuts or about.",
        inputSchema: obj({ section: { type: "string" } }),
        execute: run(async ({ section }) => (live.current.ws.openSettings((section as never) ?? "account"), "Settings opened.")),
      },
      {
        name: "max_operation",
        description:
          "Run any Max operation as the user, in the open workspace: the same ones Max's MCP server offers (e.g. pages.update, documents.writeMarkdown, blocks.insert, records.create, databases.query, shares.invite). Destructive operations need confirm: true, which you should only pass after the user agrees.",
        inputSchema: obj({ op: { type: "string", description: "Operation name, like pages.update." }, args: { type: "object" } }, ["op"]),
        execute: run(async ({ op, args }) => {
          const name = String(op);
          const input = (args as Record<string, unknown>) ?? {};
          if (BLOCKED.has(name)) throw new Error(`“${name}” isn't available to assistants in the browser. Ask the person to do it in Max.`);
          // A page the agent read could try to steer it: anything that removes, shares or confirms
          // something is shown to the person to approve first.
          if (ASKS_FIRST.test(name) || input.confirm === true) {
            const ok = await confirmAction({
              title: "Let the assistant do this?",
              body: <p>Your browser's assistant wants to run <strong>{name}</strong> in Max{input.confirm === true ? ", which can't be undone" : ""}.</p>,
              confirmLabel: "Allow",
              tone: "danger",
            });
            if (!ok) throw new Error("The person declined.");
          }
          return call(name, input);
        }),
      },
    ];

    const undo: (() => void)[] = [];
    if (mc.registerTool) {
      for (const tool of tools) {
        const handle = mc.registerTool(tool);
        undo.push(() => (handle && handle.unregister ? handle.unregister() : mc.unregisterTool?.(tool.name)));
      }
    } else if (mc.provideContext) {
      mc.provideContext({ tools });
      undo.push(() => mc.clearContext?.());
    }
    return () => undo.forEach((fn) => {
      try {
        fn();
      } catch {
        // The page is going away; nothing to clean up.
      }
    });
  }, []);

  return null;
}
