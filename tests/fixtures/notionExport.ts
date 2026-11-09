import { strToU8, zipSync } from "fflate";

/**
 * A Notion "Markdown & CSV" export shaped like the real thing: an outer zip wrapping a
 * "-Part-1.zip", 32-hex ids in every file name, %20-encoded relative links, a database CSV
 * with its "_all" twin, row pages that start with property lines, <aside> callouts,
 * <details> toggles, tables, to-dos and an image next to the page that uses it.
 */
const id = (n: number) => n.toString(16).padStart(32, "0").replace(/^0/, "a");
const enc = (s: string) => s.replace(/ /g, "%20");

// 1×1 PNG
const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));

export function notionExportZip(): Uint8Array {
  const home = `Studio ${id(1)}`;
  const db = `Video Tracker ${id(2)}`;
  const ideas = `Ideas ${id(4)}`;
  const csv = [
    "﻿Name,Stage,Platform,Publish Date,Views,Published,Link",
    `Launch trailer,Editing,YouTube,"November 20, 2026","1,250",No,https://example.com/trailer`,
    `Behind the scenes,Idea,"TikTok, Instagram",,,No,`,
    `Studio tour,Published,YouTube,"October 2, 2026",8400,Yes,https://example.com/tour`,
  ].join("\n");
  const files: Record<string, Uint8Array> = {
    [`${home}.md`]: strToU8(
      [
        "# Studio",
        "",
        "Everything for the channel lives here.",
        "",
        "<aside>",
        "💡 Film on Tuesdays, edit on Wednesdays.",
        "</aside>",
        "",
        `[Video Tracker](${enc(home)}/${enc(db)}.csv)`,
        "",
        `[Ideas](${enc(home)}/${enc(ideas)}.md)`,
        "",
        `![Studio desk](${enc(home)}/desk.png)`,
      ].join("\n"),
    ),
    [`${home}/desk.png`]: PNG,
    [`${home}/${db}.csv`]: strToU8(csv),
    [`${home}/${db}_all.csv`]: strToU8(csv),
    [`${home}/${db}/Launch trailer ${id(3)}.md`]: strToU8(
      ["# Launch trailer", "", "Stage: Editing", "Platform: YouTube", "Publish Date: November 20, 2026", "", "## Script", "", "Open on the empty studio, then cut to the team.", "", "- [x] Rough cut", "- [ ] Color grade"].join("\n"),
    ),
    [`${home}/${ideas}.md`]: strToU8(
      [
        "# Ideas",
        "",
        "## Next quarter",
        "",
        "1. Viewer Q&A",
        "2. Gear guide",
        "",
        "<details>",
        "<summary>Rejected ideas</summary>",
        "Daily vlogs",
        "</details>",
        "",
        "| Idea | Effort |",
        "| --- | --- |",
        "| Q&A | Low |",
        "| Gear guide | Medium |",
        "",
        `Back to [Studio](../${enc(home)}.md)`,
      ].join("\n"),
    ),
  };
  const part = zipSync(files);
  return zipSync({ "Export-5f1c9b2e-Part-1.zip": part });
}
