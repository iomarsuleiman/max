/** Capture the real app with disposable sample content, never private workspace data. */
import { chromium } from "@playwright/test";
import sharp from "sharp";
import { mkdir } from "node:fs/promises";

const base = process.env.MAX_CAPTURE_URL || "http://localhost:3336";
if (!["localhost", "127.0.0.1"].includes(new URL(base).hostname)) throw new Error("Use a disposable local server for capture fixtures.");
const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const op = async (name, args = {}) => {
    const response = await context.request.post(`${base}/api/local/ops`, { data: { op: name, args } });
    const body = await response.json();
    if (!response.ok()) throw new Error(`${name}: ${JSON.stringify(body.error)}`);
    return body.result;
  };
  await op("account.init");
  await op("settings.update", { onboarded: true, profileCardOnboarded: true, displayName: "Avery", sidebarWidth: 248, profileCard: { name: "Avery", subtitle: "Curious explorer", bio: "", theme: "mint", pattern: "gradient", shape: "band" } });
  const notes = ["Design journal", "A quieter workspace", "Field notes", "Things to make", "Reading shelf", "Small discoveries", "Weekend plans", "The garden", "A good routine", "Ideas worth keeping", "Places to go", "Next chapter"];
  const icons = ["📔", "🌿", "🗒️", "🛠️", "📚", "✨", "☀️", "🌱", "☕", "💡", "🧭", "🪁"];
  const pages = [];
  for (const [index, title] of notes.entries()) pages.push((await op("pages.create", { title, icon: icons[index] })).page);
  await op("pages.setFavorite", { id: pages[0]._id, favorite: true });
  await op("pages.setFavorite", { id: pages[4]._id, favorite: true });
  for (let index = 0; index < pages.length; index++) {
    const links = [pages[(index + 1) % pages.length], pages[(index + 3) % pages.length]].map((link) => `[${link.title}](/p/${link._id})`).join(" · ");
    const markdown = index === 0
      ? `A place to collect what catches your eye. No need to have it all figured out.\n\n## Make a little room\n\nGood ideas rarely arrive in order. Keep a page open for the unexpected.\n\n- [x] Gather a few things that inspire you\n- [x] Find the thread between them\n- [ ] Make something small\n\n## Follow your curiosity\n\n${links}\n\n> Start anywhere. You can always move things around later.\n\n## On the horizon\n\nA weekend project, a book to finish, a new way of seeing an old idea.`
      : `A few notes about ${pages[index].title.toLowerCase()}.\n\n## Worth remembering\n\nLeave room for something unexpected.\n\n${links}\n\n- A little progress every day\n- Keep the useful things close\n- Follow the next good question`;
    await op("documents.writeMarkdown", { pageId: pages[index]._id, markdown });
  }
  await mkdir("public/screenshots", { recursive: true });
  const capture = async (name, theme) => {
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(250);
    await sharp(await page.screenshot({ animations: "disabled" })).webp({ quality: 88 }).toFile(`public/screenshots/${name}-${theme}.webp`);
  };
  for (const theme of ["light", "dark"]) {
    await op("settings.update", { theme });
    await page.goto(`${base}/p/${pages[0]._id}`);
    await page.locator(".bn-editor").waitFor();
    await page.evaluate((value) => { localStorage.setItem("max:theme", value); document.documentElement.classList.remove("light", "dark"); document.documentElement.classList.add(value); }, theme);
    await capture("editor", theme);
    await page.goto(`${base}/graph`);
    await page.getByRole("img", { name: /Graph of/ }).waitFor();
    await page.evaluate(() => localStorage.setItem("max:graph-global", JSON.stringify({ repel: 26, linkDistance: 190, center: .2, orphans: false, nodeSize: 1.5, labels: .4 })));
    await page.reload();
    await page.getByRole("img", { name: /Graph of/ }).waitFor();
    await page.waitForTimeout(1800);
    await page.getByRole("button", { name: "Fit to screen", exact: true }).click();
    await page.waitForTimeout(350);
    await capture("graph", theme);
    await page.goto(`${base}/home?settings=account`);
    await page.getByRole("article", { name: "Your profile card preview" }).waitFor();
    await page.locator(".card-studio").scrollIntoViewIfNeeded();
    await capture("card", theme);
    await page.getByRole("button", { name: "Close settings", exact: true }).click();
    await page.goto(`${base}/p/${pages[4]._id}`);
    await page.locator(".bn-editor").waitFor();
    await capture("sidebar", theme);
  }
} finally {
  await browser.close();
}
