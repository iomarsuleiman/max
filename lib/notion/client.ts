import { NOTION_VERSION, object, objects, sourceFrom, text, type NotionSource } from "./types";

export class NotionError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryAfter = 0,
  ) {
    super(message);
  }
}
/** Only Notion API routes can be requested. Tokens are never sent to media hosts. */
export async function notionRequest(token: string, path: string, body?: unknown): Promise<Record<string, unknown>> {
  if (!/^\/(pages|blocks|databases|data_sources|search)(\/|\?|$)/.test(path)) throw new Error("Unsupported Notion API route.");
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`https://api.notion.com/v1${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { Authorization: `Bearer ${token}`, "Notion-Version": NOTION_VERSION, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
      redirect: "error",
    });
    if (res.ok) return object(await res.json());
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      const delay = Math.min(10_000, Math.max(500 * 2 ** attempt, (Number(res.headers.get("retry-after")) || 1) * 1000));
      await new Promise((resolve) => setTimeout(resolve, delay));
      continue;
    }
    // Do not relay provider bodies, which can contain private source values.
    throw new NotionError(
      res.status === 401
        ? "reconnect_required"
        : res.status === 403
          ? "permission_denied"
          : res.status === 404
            ? "source_unavailable"
            : res.status === 429
              ? "rate_limited"
              : "provider_error",
      res.status === 401
        ? "Notion access expired. Reconnect Notion, then retry this import."
        : res.status === 404
          ? "This source is no longer shared with Max in Notion."
          : "Notion could not complete this request. Try again shortly.",
    );
  }
  throw new NotionError("provider_error", "Notion is temporarily unavailable.");
}
export async function listSources(token: string, query = "", cursor?: string): Promise<{ sources: NotionSource[]; nextCursor: string | null }> {
  const data = await notionRequest(token, "/search", { query, page_size: 50, ...(cursor ? { start_cursor: cursor } : {}) });
  return {
    sources: objects(data.results)
      .filter((o) => !o.archived && !o.in_trash)
      .map(sourceFrom),
    nextCursor: data.has_more ? text(data.next_cursor) || null : null,
  };
}
export async function getSource(token: string, id: string): Promise<Record<string, unknown>> {
  for (const type of ["pages", "data_sources", "databases"]) {
    try {
      return await notionRequest(token, `/${type}/${id}`);
    } catch (error) {
      if (!(error instanceof NotionError) || error.code !== "source_unavailable") throw error;
    }
  }
  throw new NotionError("source_unavailable", "This page is not shared with Max. Share it in Notion and try again.");
}
export function trustedMediaUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return (
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      (!u.port || u.port === "443") &&
      (u.hostname === "prod-files-secure.s3.us-west-2.amazonaws.com" ||
        u.hostname === "s3.us-west-2.amazonaws.com" ||
        u.hostname === "file.notion.so" ||
        u.hostname === "secure.notion-static.com" ||
        u.hostname === "www.notion.so")
    );
  } catch {
    return false;
  }
}
