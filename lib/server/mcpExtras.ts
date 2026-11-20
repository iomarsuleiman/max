import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import TurndownService from "turndown";
import { MaxError } from "@/lib/domain/errors";
import { LIMITS, UPLOAD_TYPES } from "@/lib/domain/ops/helpers";
import { runForOwner } from "./executor";
import { saveLocalFile } from "./local";
import { CLOUD } from "@/lib/config";

/**
 * Composite assistant tools that need the server's network or Node APIs. They do their checks,
 * then call the same domain operations the app uses (assets.createUploadUrl/register, import.markdown).
 */

function privateIPv4(octets: number[]): boolean {
  if (octets.length !== 4 || octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = octets;
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

function parseIPv6Groups(raw: string): number[] | null {
  let ip = raw.toLowerCase().split("%")[0];
  if (ip.includes(".")) {
    const lastColon = ip.lastIndexOf(":");
    if (lastColon < 0) return null;
    const v4 = ip.slice(lastColon + 1).split(".").map(Number);
    if (v4.length !== 4 || v4.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
    const hi = ((v4[0] << 8) | v4[1]).toString(16);
    const lo = ((v4[2] << 8) | v4[3]).toString(16);
    ip = `${ip.slice(0, lastColon)}:${hi}:${lo}`;
  }
  const halves = ip.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - (left.length + right.length);
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 0)) return null;
  const parts = halves.length === 2 ? [...left, ...Array(missing).fill("0"), ...right] : left;
  const groups = parts.map((p) => (/^[0-9a-f]{1,4}$/.test(p) ? parseInt(p, 16) : NaN));
  return groups.length === 8 && groups.every(Number.isFinite) ? groups : null;
}

function privateAddress(ip: string): boolean {
  if (ip.includes(":")) {
    const g = parseIPv6Groups(ip);
    if (!g) return true;
    const allZero6 = g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0;
    // :: (unspecified), ::1 (loopback)
    if (allZero6 && g[6] === 0 && (g[7] === 0 || g[7] === 1)) return true;
    // ::ffff:0:0/96 (IPv4-mapped) or 64:ff9b::/96 (NAT64)
    const isV4Mapped = g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0xffff;
    const isNat64 = g[0] === 0x0064 && g[1] === 0xff9b && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0;
    if (isV4Mapped || isNat64) return privateIPv4([g[6] >> 8, g[6] & 0xff, g[7] >> 8, g[7] & 0xff]);
    // fc00::/7 (ULA), fe80::/10 (link-local), fec0::/10 (site-local), ff00::/8 (multicast), 100::/64 (discard)
    if ((g[0] & 0xfe00) === 0xfc00) return true;
    if ((g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xffc0) === 0xfec0) return true;
    if ((g[0] & 0xff00) === 0xff00) return true;
    if (g[0] === 0x0100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return true;
    return false;
  }
  return privateIPv4(ip.split(".").map(Number));
}

/** Fetches a public https URL, refusing private networks, redirects to them, and oversized bodies. */
export async function safeFetch(rawUrl: string, maxBytes: number): Promise<{ bytes: Uint8Array; type: string; url: URL }> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new MaxError("VALIDATION", "That isn't a valid URL.");
  }
  for (let hop = 0; hop < 4; hop++) {
    if (url.protocol !== "https:") throw new MaxError("VALIDATION", "Only https links can be fetched.");
    if (url.port && url.port !== "443") throw new MaxError("VALIDATION", "Only standard https (port 443) links can be fetched.");
    if (url.username || url.password) throw new MaxError("VALIDATION", "Links with credentials aren't allowed.");
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
    if (!addresses.length) throw new MaxError("VALIDATION", `Couldn't find ${host}.`);
    if (addresses.some((a) => privateAddress(a.address))) throw new MaxError("VALIDATION", "That address points to a private network and can't be fetched.");
    const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(15_000), headers: { "User-Agent": "Max/1.0 (+https://max.chaos.fail)" } });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      url = new URL(res.headers.get("location")!, url);
      continue;
    }
    if (!res.ok || !res.body) throw new MaxError("VALIDATION", `The server returned ${res.status} for that link.`);
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > maxBytes) throw new MaxError("LIMIT", `That file is larger than ${Math.round(maxBytes / 1024 / 1024)} MB.`);
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new MaxError("LIMIT", `That file is larger than ${Math.round(maxBytes / 1024 / 1024)} MB.`);
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      bytes.set(c, offset);
      offset += c.byteLength;
    }
    return { bytes, type: (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase(), url };
  }
  throw new MaxError("VALIDATION", "Too many redirects.");
}

function sniffImageType(bytes: Uint8Array): string | null {
  const b = bytes;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45) return "image/webp";
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return "image/avif";
  return null;
}

/** Uploads an image from a public URL or base64 data, using the app's own upload flow. */
export async function uploadAsset(ownerId: string, input: { url?: string; base64?: string; name?: string; pageId?: string | null; alt?: string }) {
  let bytes: Uint8Array;
  let name = input.name ?? "image";
  if (input.url) {
    const fetched = await safeFetch(input.url, LIMITS.uploadBytes);
    bytes = fetched.bytes;
    if (!input.name) name = decodeURIComponent(fetched.url.pathname.split("/").pop() || "image").slice(0, 120);
  } else if (input.base64) {
    const clean = input.base64.replace(/^data:[^;]+;base64,/, "");
    bytes = new Uint8Array(Buffer.from(clean, "base64"));
    if (bytes.byteLength > LIMITS.uploadBytes) throw new MaxError("LIMIT", "That image is larger than 20 MB.");
  } else {
    throw new MaxError("VALIDATION", "Pass either url or base64.");
  }
  // The file's real bytes decide its type, not the name or the server's header.
  const type = sniffImageType(bytes);
  if (!type || !UPLOAD_TYPES.includes(type)) throw new MaxError("VALIDATION", "That isn't a PNG, JPEG, WebP, GIF or AVIF image.");
  let storageId: string;
  if (!CLOUD) {
    storageId = await saveLocalFile(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, type);
  } else {
    const start = (await runForOwner(ownerId, "assets.createUploadUrl", { type, size: bytes.byteLength })) as { uploadUrl: string; method?: "PUT"; headers?: Record<string, string>; storageId?: string };
    const res = await fetch(start.uploadUrl, { method: start.method ?? "POST", headers: start.headers ?? { "Content-Type": type }, body: bytes as BodyInit });
    if (!res.ok) throw new MaxError("INTERNAL", "Storing the image failed. Try again.");
    storageId = start.method === "PUT" && start.storageId ? start.storageId : ((await res.json()) as { storageId: string }).storageId;
  }
  return runForOwner(ownerId, "assets.register", { storageId, pageId: input.pageId ?? null, name, type, size: bytes.byteLength, alt: input.alt ?? "" });
}

const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-", emDelimiter: "*" });
turndown.remove(["script", "style", "noscript", "iframe", "object", "embed", "form"]);

export function htmlToMarkdown(html: string): string {
  return turndown.turndown(html.slice(0, 2_000_000));
}

/** Imports HTML (pasted or from a public URL) as a new page. */
export async function importHtml(ownerId: string, input: { html?: string; url?: string; title?: string; parentId?: string | null }) {
  let html = input.html;
  let title = input.title;
  if (!html && input.url) {
    const res = await safeFetch(input.url, 5 * 1024 * 1024);
    if (!res.type.includes("html")) throw new MaxError("VALIDATION", "That link isn't a web page.");
    html = new TextDecoder().decode(res.bytes);
  }
  if (!html) throw new MaxError("VALIDATION", "Pass html or url.");
  if (!title) title = /<title[^>]*>([^<]{1,300})<\/title>/i.exec(html)?.[1]?.trim();
  const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html;
  const markdown = htmlToMarkdown(body).slice(0, 400_000);
  return runForOwner(ownerId, "import.markdown", { markdown, title, parentId: input.parentId ?? null });
}
