import { test, expect } from "@playwright/test";

const scope = { accountId: "alice", workspaceId: "pr23-lab", pageId: "page-1" };
const open = async (page, overrides = {}) => {
  return page.evaluate(async values => {
    const { acquireBrowserRoomLease } = await import("/room-lease.mjs");
    window.__pr23Lease = await acquireBrowserRoomLease(values);
    return Boolean(window.__pr23Lease);
  }, { ...scope, ...overrides });
};
const tryOpen = async (page, overrides = {}) => {
  return page.evaluate(async values => {
    try {
      const { acquireBrowserRoomLease } = await import("/room-lease.mjs");
      window.__pr23Lease = await acquireBrowserRoomLease(values);
      return "acquired";
    } catch (error) { return error.message; }
  }, { ...scope, ...overrides });
};

test("real browser tabs cannot write one account-room simultaneously; close releases lock", async ({ context }) => {
  const first = await context.newPage();
  const second = await context.newPage();
  await Promise.all([first.goto("/journal-test.html"), second.goto("/journal-test.html")]);
  expect(await open(first)).toBe(true);
  expect(await tryOpen(second)).toBe("ROOM_ALREADY_OPEN_IN_ANOTHER_TAB");
  await first.close();
  await expect.poll(() => tryOpen(second), { timeout: 10_000 }).toBe("acquired");
  await second.evaluate(() => window.__pr23Lease.release());
});

test("different account or page may hold its own lock; explicit release permits takeover", async ({ context }) => {
  const first = await context.newPage();
  const account = await context.newPage();
  const page = await context.newPage();
  await Promise.all([first, account, page].map(p => p.goto("/journal-test.html")));
  expect(await open(first)).toBe(true);
  expect(await open(account, { accountId: "bob" })).toBe(true);
  expect(await open(page, { pageId: "page-2" })).toBe(true);
  await first.evaluate(() => window.__pr23Lease.release());
  await expect.poll(() => tryOpen(first), { timeout: 10_000 }).toBe("acquired");
  await Promise.all([first, account, page].map(p => p.close()));
});

test("a denied tab does not bypass local account/page IndexedDB isolation", async ({ context }) => {
  const first = await context.newPage();
  const second = await context.newPage();
  await Promise.all([first.goto("/journal-test.html"), second.goto("/journal-test.html")]);
  await open(first);
  const operation = await first.evaluate(() => window.__pr19Journal.stage());
  expect(await tryOpen(second)).toBe("ROOM_ALREADY_OPEN_IN_ANOTHER_TAB");
  expect(await second.evaluate(() => window.__pr19Journal.read("bob"))).toEqual([]);
  expect(await second.evaluate(() => window.__pr19Journal.read("alice", "other"))).toEqual([]);
  expect((await second.evaluate(() => window.__pr19Journal.read()))[0]).toEqual(operation);
  // IndexedDB is same-origin shared: this test deliberately does NOT claim it
  // provides a security boundary between hostile same-origin scripts.
  await first.close();
  await second.close();
});
