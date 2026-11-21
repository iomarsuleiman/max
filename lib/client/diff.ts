/** Plain-text lines of BlockNote blocks (nested children indented), for comparing two versions. */
export function blockLines(blocks: unknown[], depth = 0): string[] {
  const out: string[] = [];
  for (const raw of blocks as { type?: string; content?: unknown; children?: unknown[]; props?: Record<string, unknown> }[]) {
    const text = inline(raw.content);
    const marker = raw.type === "heading" ? "#".repeat(Number(raw.props?.level ?? 1)) + " " : raw.type === "bulletListItem" ? "• " : raw.type === "numberedListItem" ? "1. " : raw.type === "checkListItem" ? (raw.props?.checked ? "☑ " : "☐ ") : "";
    const label = text || (raw.type && raw.type !== "paragraph" ? `[${raw.type}]` : "");
    out.push("  ".repeat(depth) + marker + label);
    if (Array.isArray(raw.children) && raw.children.length) out.push(...blockLines(raw.children, depth + 1));
  }
  return out;
}

function inline(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) {
    const rows = (content as { rows?: { cells?: unknown[] }[] } | undefined)?.rows;
    return rows ? rows.map((r) => (r.cells ?? []).map((c) => inline((c as { content?: unknown })?.content ?? c)).join(" | ")).join(" / ") : "";
  }
  return content.map((c) => (typeof c === "string" ? c : ((c as { text?: string; content?: unknown }).text ?? inline((c as { content?: unknown }).content)))).join("");
}

export type DiffLine = { type: "same" | "add" | "remove"; text: string };

/** Line diff (longest common subsequence), capped so huge pages stay fast. */
export function diffLines(a: string[], b: string[]): DiffLine[] {
  if (a.length * b.length > 4_000_000) return [...a.map((text) => ({ type: "remove" as const, text })), ...b.map((text) => ({ type: "add" as const, text }))];
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) (out.push({ type: "same", text: a[i] }), i++, j++);
    else if (dp[i + 1][j] >= dp[i][j + 1]) out.push({ type: "remove", text: a[i++] });
    else out.push({ type: "add", text: b[j++] });
  }
  while (i < n) out.push({ type: "remove", text: a[i++] });
  while (j < m) out.push({ type: "add", text: b[j++] });
  return out;
}
