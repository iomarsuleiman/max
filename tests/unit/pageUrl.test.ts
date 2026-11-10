import { describe, expect, it } from "vitest";
import { PAGE_LINK_RE, pageHref, pageIdFromParam, pageIdFromPath, pageSlug } from "@/lib/pageUrl";
import { referencedPageIds } from "@/lib/domain/blocks";

describe("readable page URLs", () => {
  it("builds slugs from titles", () => {
    expect(pageSlug("Max — MCP Audit & Notion Import Plan")).toBe("max-mcp-audit-notion-import-plan");
    expect(pageSlug("")).toBe("untitled");
    expect(pageSlug("Don't panic")).toBe("dont-panic");
    expect(pageSlug("خطة العمل")).toBe("خطة-العمل");
    expect(pageHref("abc123", "Video pipeline")).toBe("/p/video-pipeline-abc123");
    expect(pageHref("abc123")).toBe("/p/abc123");
  });

  it("finds the id with or without the title words", () => {
    expect(pageIdFromParam("video-pipeline-abc123")).toBe("abc123");
    expect(pageIdFromParam("abc123")).toBe("abc123");
    expect(pageIdFromParam(encodeURIComponent("خطة-abc123"))).toBe("abc123");
    expect(pageIdFromPath("/p/old-title-abc123")).toBe("abc123");
    expect(pageIdFromPath("/templates")).toBeNull();
  });

  it("treats slug links in content as page links", () => {
    expect(PAGE_LINK_RE.exec("/p/video-pipeline-abc123?peek=x")?.[1]).toBe("abc123");
    const blocks = [{ id: "b", type: "paragraph", props: {}, content: [{ type: "link", href: "/p/some-page-xyz789", content: [{ type: "text", text: "x", styles: {} }] }], children: [] }];
    expect(referencedPageIds(blocks as never)).toEqual(["xyz789"]);
  });
});
