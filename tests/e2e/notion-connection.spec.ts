import { expect, test } from "@playwright/test";

test("Notion copies use selection, review, persisted progress and a report", async ({ page }) => {
  let started = 0;
  let selection: Record<string, unknown> = {};
  const root = {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    title: "Research عمر",
    kind: "page",
    url: "https://www.notion.so/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  };
  await page.route("**/api/notion", async (route) => {
    const { operation, args } = route.request().postDataJSON();
    const job = {
      jobId: "job-one",
      status: "completed_with_warnings",
      created: 3,
      attachments: 2,
      skipped: 1,
      failed: 0,
      rootIds: [],
      warnings: [{ sourceId: root.id, message: "A formula was retained as a static value." }],
    };
    let result: unknown;
    switch (operation) {
      case "status":
        result = { configured: true, connected: true, workspace: { id: "workspace", name: "Personal" } };
        break;
      case "sources":
        result = { sources: [root], nextCursor: null };
        break;
      case "preview":
        selection = args;
        result = { roots: [root], warnings: ["Comments and history are not imported."], exact: false };
        break;
      case "start":
        started++;
        expect(args.idempotencyKey).toBeTruthy();
        expect(args.sourceIds).toEqual([root.id]);
        result = { jobId: "job-one" };
        break;
      case "job":
      case "report":
        result = job;
        break;
      case "history":
        result = { jobs: [job] };
        break;
      default:
        throw new Error(`Unexpected operation ${operation}`);
    }
    await route.fulfill({ json: { result } });
  });
  await page.goto("/home?settings=connections");
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  await settings.getByRole("button", { name: "Import from Notion", exact: true }).click();
  await settings.getByRole("checkbox", { name: "Research عمر" }).check();
  await settings.getByRole("button", { name: "Review import", exact: true }).click();
  expect(selection).toMatchObject({ sourceIds: [root.id], parentId: null, includeDescendants: true });
  await expect(settings.getByText("Comments and history are not imported.")).toBeVisible();
  await settings.getByRole("button", { name: "Import a copy", exact: true }).click();
  await expect(settings.getByRole("heading", { name: "Import report", exact: true })).toBeVisible();
  expect(started).toBe(1);
  await settings.getByText("Review 1 import warnings").click();
  await expect(settings.getByText("A formula was retained as a static value.")).toBeVisible();
  const downloaded = page.waitForEvent("download");
  await settings.getByRole("button", { name: "Download report", exact: true }).click();
  expect((await downloaded).suggestedFilename()).toBe("max-notion-import-report.json");
});

test("Notion setup problems retain the existing ZIP fallback", async ({ page }) => {
  await page.route("**/api/notion", (route) =>
    route.fulfill({
      json: { result: { configured: false, connected: false, workspace: null, reason: "Direct imports require a configured cloud connection." } },
    }),
  );
  await page.goto("/home?settings=connections");
  await expect(page.getByText("Direct imports require a configured cloud connection.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Connect Notion", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Import from an export file", exact: true }).click();
  await expect(page.getByRole("dialog", { name: /Import/ })).toBeVisible();
});
