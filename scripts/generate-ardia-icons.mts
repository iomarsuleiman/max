/** Regenerate portable Ardia UI artwork. Normal builds never fetch remote resources. */
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const revision = "6dfa0aca9fbc2b29f6866f2346546b0c6939e134";
const base = `https://raw.githubusercontent.com/ardia-browser/ardia/${revision}`;
async function sourceFile(path: string) {
  if (process.env.ARDIA_SOURCE_DIR) return readFile(join(process.env.ARDIA_SOURCE_DIR, path.split("/").pop()!), "utf8");
  const response = await fetch(`${base}/${path}`);
  if (!response.ok) throw new Error(`Cannot fetch ${path}: ${response.status}`);
  return response.text();
}
const tmp = await mkdtemp(join(tmpdir(), "max-ardia-"));
for (const name of ["data.ts", "render.ts"]) {
  await writeFile(join(tmp, name), await sourceFile(`apps/linux/src/shims/web/symbols/${name}`));
}
const { symbolLayers } = await import(pathToFileURL(join(tmp, "data.ts")).href);
const { symbolMarkup } = await import(pathToFileURL(join(tmp, "render.ts")).href);
const mapping = new Map((await readFile("scripts/ardia-icon-map.txt", "utf8")).trim().split("\n").map(line => { const [name, symbol] = line.split("="); if (!name || !symbol) throw new Error(`Invalid mapping: ${line}`); return [name, symbol] as const; }));
const generated: string[] = [];
let output = `"use client";\n// Generated from Ardia ${revision}. See components/icons/NOTICE.\nimport { forwardRef, useId } from "react";\nimport type { LucideProps } from "lucide-react";\nexport { Activity, AlertCircle, AlertTriangle, AlignLeft, AppWindow, ArrowDownWideNarrow, ArrowLeft, Bot, Calculator, ChevronsLeft, GripVertical, Loader2, Octagon, Save, Sigma } from "lucide-react";
export type { LucideIcon } from "lucide-react";\n\nfunction icon(name: string, artwork: string) {\n  const Component = forwardRef<SVGSVGElement, LucideProps>(function ArdiaIcon({ size = 24, color = "currentColor", className, children: _children, ...props }, ref) {\n    const id = useId().replaceAll(":", "_");\n    return <svg {...props} ref={ref} width={size} height={size} viewBox="0 0 24 24" color={color} fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={["lucide", "ardia-icon", className].filter(Boolean).join(" ")} dangerouslySetInnerHTML={{ __html: artwork.replaceAll("ARDIAID", id) }} />;\n  });\n  Component.displayName = name;\n  return Component;\n}\n`;
for (const [name, symbol] of mapping) {
  const layers = symbolLayers(symbol);
  if (!layers) { console.warn(`No Ardia symbol for ${name}: ${symbol}; keeping Lucide`); output += `export { ${name} } from "lucide-react";\n`; continue; }
  generated.push(name);
  const svg = symbolMarkup(layers, { pointSize: 16, weight: "regular", width: 24, height: 24, color: "currentColor", id: "ARDIAID" });
  const body = svg.slice(svg.indexOf(">") + 1, svg.lastIndexOf("</svg>"));
  output += `export const ${name} = icon(${JSON.stringify(name)}, ${JSON.stringify(body)});\n`;
}
output += `export const ARDIA_BY_NAME: Record<string, ReturnType<typeof icon>> = {\n${generated.map(name => `${JSON.stringify(name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase())}: ${name}`).join(",\n")}\n};\n`;
await mkdir("components/icons", { recursive: true });
await writeFile("components/icons/index.tsx", output);
for (const [remote, local] of [["NOTICE", "NOTICE"], ["LICENSE.Apache-2.0", "LICENSE.Apache-2.0"], ["apps/linux/src/shims/web/symbols/THIRD_PARTY_NOTICES.txt", "THIRD_PARTY_NOTICES.txt"]]) {
  await writeFile(`components/icons/${local}`, await sourceFile(remote));
}
