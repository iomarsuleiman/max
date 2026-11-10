// Builds lib/client/emoji-data.json from emojibase-data: [emoji, label, group, keywords, unicodeVersion].
// The version lets the picker hide emoji the device's font can't draw yet.
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const data = JSON.parse(await readFile(require.resolve("emojibase-data/en/data.json"), "utf8"));
const messages = JSON.parse(await readFile(require.resolve("emojibase-data/en/messages.json"), "utf8"));
const COMPONENTS = 2; // skin tone and hair swatches, not pickable on their own
const title = (s) => s.replace(/(^|\s)\S/g, (c) => c.toUpperCase()).replace(/ And /g, " & ");
const groups = messages.groups.filter((g) => g.order !== COMPONENTS).map((g) => title(g.message));
const remap = new Map(messages.groups.filter((g) => g.order !== COMPONENTS).map((g, i) => [g.order, i]));
const emoji = data
  .filter((e) => e.group !== undefined && e.group !== COMPONENTS)
  .sort((a, b) => a.order - b.order)
  .map((e) => [e.emoji, e.label, remap.get(e.group), (e.tags ?? []).slice(0, 6).join(" "), e.version]);
await writeFile(new URL("../lib/client/emoji-data.json", import.meta.url), JSON.stringify({ groups, emoji }));
console.log(`${emoji.length} emoji in ${groups.length} groups.`);
