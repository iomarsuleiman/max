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
  // Short, concrete sample pages: every title fits the sidebar without truncation.
  const notes = [
    ["Lisbon trip", "🧳"],
    ["Reading list", "📚"],
    ["Weekly plan", "🗓️"],
    ["Recipes", "🍳"],
    ["Garden", "🌱"],
    ["Journal", "📔"],
    ["Book notes", "📖"],
    ["Gift ideas", "🎁"],
    ["Workouts", "🏃"],
    ["Side project", "🛠️"],
  ];
  const bodies = {
    "Reading list": "Books for trains and slow evenings.\n\n- [x] The Book of Disquiet\n- [ ] A Little Life\n- [ ] Something with a map in the front",
    "Weekly plan": "Three things that matter this week.\n\n- [x] Send the draft\n- [ ] Call Mum on Sunday\n- [ ] Water the basil",
    Recipes: "What we keep cooking.\n\n- Lemon pasta, ten minutes\n- Shakshuka for Saturdays\n- Pastéis de nata, someday",
    Garden: "What is growing, and what needs a hand.\n\n- Tomatoes on the balcony\n- Mint, out of control\n- Plant tulips in October",
    Journal: "A line a day is enough.\n\n> Long walk by the river. Found the bakery again.",
    "Book notes": "Lines worth keeping.\n\n> “I am the size of what I see.” Pessoa",
    "Gift ideas": "Small things people mentioned once.\n\n- Sam: a film camera\n- Lea: anything with figs",
    Workouts: "Easy, steady, three times a week.\n\n- Monday run, 5 km\n- Wednesday swim\n- Saturday long walk",
    "Side project": "A tiny app for tracking plants.\n\n- [x] Sketch the screens\n- [ ] Pick a name",
  };
  const pages = [];
  for (const [title, icon] of notes) pages.push((await op("pages.create", { title, icon })).page);
  await op("pages.setFavorite", { id: pages[0]._id, favorite: true });
  await op("pages.setFavorite", { id: pages[1]._id, favorite: true });
  for (let index = 0; index < pages.length; index++) {
    const links = [pages[(index + 1) % pages.length], pages[(index + 3) % pages.length]].map((link) => `[${link.title}](/p/${link._id})`).join(" · ");
    const markdown = index === 0
      ? `Four days in May. Slow mornings, long lunches, one good map.\n\n## Before we go\n\n- [x] Book the flat in Alfama\n- [x] Reserve dinner for Friday\n- [ ] Download offline maps\n\n## Day one\n\nTram 28 up to the castle, then pastéis de nata in Belém.\n\n${links}\n\n> Keep the best photos for the journal.\n\n## Still deciding\n\nFado on Friday, or a day trip to Sintra.`
      : `${bodies[pages[index].title]}\n\nSee also: ${links}`;
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
    await page.goto(`${base}/p/${pages[1]._id}`);
    await page.locator(".bn-editor").waitFor();
    await capture("sidebar", theme);
  }
} finally {
  await browser.close();
}
