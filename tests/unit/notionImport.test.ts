import { describe, expect, it } from "vitest";
import { buildNotionBundle, cleanMarkdown, inferType, parseCsv } from "@/lib/import/notion";
import { setup } from "./harness";

const enc = new TextEncoder();
const file = (path: string, text: string) => ({ path, data: enc.encode(text) });

describe("Notion import", () => {
  it("parses CSV with quotes and newlines", () => {
    expect(parseCsv('﻿Name,Notes\n"A, b","line1\nline2"\n"He said ""hi""",x\n')).toEqual([
      ["Name", "Notes"],
      ["A, b", "line1\nline2"],
      ['He said "hi"', "x"],
    ]);
  });

  it("infers property types", () => {
    expect(inferType("Done", ["Yes", "No", ""]).type).toBe("checkbox");
    expect(inferType("Views", ["1,200", "35", ""]).type).toBe("number");
    expect(inferType("Due", ["November 8, 2026", "December 1, 2026 → December 3, 2026"]).type).toBe("date");
    expect(inferType("Stage", ["Idea", "Editing", "Idea", "Published"])).toEqual({ type: "select", options: ["Idea", "Editing", "Published"] });
    expect(inferType("Tags", ["a, b", "b", "c, a"]).type).toBe("multi_select");
    expect(inferType("Status", ["Done", "Doing", "Done"]).type).toBe("status");
  });

  it("cleans Notion markdown", () => {
    const md = "# Title\n\nStage: Idea\nOwner: Me\n\n<aside>\n💡 Remember this\n</aside>\n\nSee [Other](Other%20abc.md) and [web](https://x.com)";
    const out = cleanMarkdown(md, (href) => (href.startsWith("Other") ? "max-import://Other" : null));
    expect(out.title).toBe("Title");
    expect(out.props).toEqual({ Stage: "Idea", Owner: "Me" });
    expect(out.body).toContain("> [!INFO]\n> Remember this");
    expect(out.body).toContain("[Other](max-import://Other)");
    expect(out.body).toContain("[web](https://x.com)");
  });

  it("rebuilds a workspace from an export and imports it", async () => {
    const id = (n: number) => String(n).padStart(32, "a");
    const entries = [
      file(`Export-1/Home ${id(1)}.md`, `# Home\n\nWelcome. See [Video Projects](Home%20${id(1)}/Video%20Projects%20${id(2)}.csv)`),
      file(`Export-1/Home ${id(1)}/Notes ${id(3)}.md`, "# Notes\n\n- [ ] one\n- [x] two"),
      file(`Export-1/Home ${id(1)}/Video Projects ${id(2)}.csv`, "Name,Stage,Platform,Publish date,Views\nTrailer,Editing,YouTube,\"November 20, 2026\",1200\nBTS,Idea,\"TikTok, Instagram\",,\n"),
      file(`Export-1/Home ${id(1)}/Video Projects ${id(2)}/Trailer ${id(4)}.md`, "# Trailer\n\nStage: Editing\nPlatform: YouTube\n\n## Script\n\nHello"),
    ];
    const { items, report } = await buildNotionBundle(entries);
    expect(report).toMatchObject({ pages: 2, databases: 1, rows: 2 });
    const db = items.find((i) => i.database)!;
    expect(db.database!.properties.map((p) => [p.name, p.type])).toEqual([
      ["Stage", "select"],
      ["Platform", "multi_select"],
      ["Publish date", "date"],
      ["Views", "number"],
    ]);
    expect(db.database!.rows[0]).toMatchObject({ title: "Trailer", values: { "Publish date": "2026-11-20", Views: 1200 } });
    expect(db.database!.rows[0].markdown).toContain("## Script");

    const { as } = setup();
    const call = as("alice");
    const res = await call("import.bundle", { items });
    expect(res.created).toBe(5);
    const tree = (await call("pages.tree")).pages;
    expect(tree.map((p: any) => p.title).sort()).toEqual(["Home", "Notes", "Video Projects"]);
    const home = tree.find((p: any) => p.title === "Home");
    const doc = await call("documents.get", { pageId: home._id, format: "markdown" });
    const dbId = tree.find((p: any) => p.title === "Video Projects")._id;
    expect(doc.markdown).toContain(`/p/${dbId}`);
    const rows = await call("databases.query", { databaseId: dbId });
    expect(rows.records.map((r: any) => r.title)).toEqual(["Trailer", "BTS"]);
  });
});
