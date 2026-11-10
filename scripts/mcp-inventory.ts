/** Regenerates docs/MCP.md's tool table from the operation registry (pnpm mcp:docs). */
import { readFileSync, writeFileSync } from "node:fs";
import { listOps } from "../lib/domain/ops";
import { NOTION_MCP_TOOLS } from "../lib/notion/tools";

const rows = listOps().map((op) => {
  const access = op.uiOnly ? "UI only" : op.kind === "query" ? "Read" : op.destructive ? "Write · needs `confirm: true`" : "Write";
  return `| \`${op.uiOnly ? "—" : op.name.replace(/\./g, "_")}\` | ${op.title} | ${access} | ${op.description.replace(/\|/g, "\\|")} |`;
});
rows.push(
  "| `assets_upload` | Upload an image | Write | Stores an image from a public https URL (private networks refused) or base64 data and returns a max-asset:// URL. |",
  "| `import_html` | Import HTML as a page | Write | Converts HTML (passed in or fetched from a public page) into a new page. |",
  "| `max_capabilities` | What Max can do | Read | Lists tools, limits, resources and error codes. |",
  "| `profileCard_exportPng` | Download my workspace card as PNG | Read | Renders the saved private card as a PNG image without publishing it. |",
);
rows.push(...NOTION_MCP_TOOLS.map((tool) => `| \`${tool.name}\` | ${tool.title} | ${tool.readOnly ? "Read" : "Write"} | ${tool.description} |`));
const count = listOps().filter((op) => !op.uiOnly).length + 4 + NOTION_MCP_TOOLS.length;
const table = ["| MCP tool | Operation | Access | What it does |", "| --- | --- | --- | --- |", ...rows].join("\n");
const file = "docs/MCP.md";
const doc = readFileSync(file, "utf8");
const next = doc.replace(/<!-- tools:start -->[\s\S]*<!-- tools:end -->/, `<!-- tools:start -->\n${table}\n<!-- tools:end -->`);
writeFileSync(file, next);
const readmeFile = "README.md";
const readme = readFileSync(readmeFile, "utf8");
writeFileSync(readmeFile, readme.replace(/\*\*Assistants \(MCP\)\.\*\* \d+ tools/, `**Assistants (MCP).** ${count} tools`));
console.log(`${count} MCP tools and ${rows.length - count} UI-only operations written to ${file}; README count updated.`);
