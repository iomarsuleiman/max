import { expect, test } from "@playwright/test";

test("outline follows headings, jumps within the page, and updates after editing", async ({ page, request }) => {
  const created = await request.post("/api/local/ops", { data: { op: "pages.create", kind: "mutation", args: { title: "Outline navigation" } } });
  const {
    result: { page: createdPage },
  } = await created.json();
  const loaded = await request.post("/api/local/ops", { data: { op: "documents.get", kind: "query", args: { pageId: createdPage._id } } });
  const { result: doc } = await loaded.json();
  const saved = await request.post("/api/local/ops", {
    data: {
      op: "documents.save",
      kind: "mutation",
      args: {
        pageId: createdPage._id,
        baseRevision: doc.revision,
        blocks: [
          { id: "outline-first", type: "heading", props: { level: 1 }, content: "First section" },
          ...Array.from({ length: 45 }, (_, i) => ({ id: `outline-paragraph-${i}`, type: "paragraph", content: `Paragraph ${i + 1}` })),
          { id: "outline-last", type: "heading", props: { level: 2 }, content: "Last section" },
        ],
      },
    },
  });
  expect(saved.ok()).toBeTruthy();
  await page.goto(`/p/${createdPage._id}`);
  const outline = page.getByRole("navigation", { name: "Page outline" });
  await expect(outline).toBeVisible();
  await outline.getByRole("button", { name: "Show page outline" }).focus();
  await expect(outline.getByRole("button", { name: "First section", exact: true })).toBeVisible();
  await outline.getByRole("button", { name: "Last section", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Last section", exact: true })).toBeInViewport();
  await page.getByRole("heading", { name: "Last section", exact: true }).click();
  await page.keyboard.press("End");
  await page.keyboard.type(" updated");
  await expect.poll(() => page.evaluate((id) => localStorage.getItem(`max:draft:${id}`), createdPage._id)).toContain("Last section updated");
  await outline.getByRole("button", { name: "Show page outline" }).hover();
  await expect(outline.getByRole("button", { name: "Last section updated", exact: true })).toBeVisible();
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(25, 25, 25)");
  await page.screenshot({ path: "test-results/outline.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(outline).toBeHidden();
});
