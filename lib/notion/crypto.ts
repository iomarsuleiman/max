/** AES-GCM encryption with an independently configured 256-bit key. Works in Convex actions. */
function keyBytes(): Uint8Array<ArrayBuffer> {
  const raw = process.env.NOTION_TOKEN_ENCRYPTION_KEY;
  if (!raw || !/^[a-f0-9]{64}$/i.test(raw)) throw new Error("NOTION_TOKEN_ENCRYPTION_KEY must contain 64 hexadecimal characters.");
  return Uint8Array.from(raw.match(/../g) ?? [], (b) => parseInt(b, 16));
}
export async function encryptToken(token: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.importKey("raw", keyBytes(), "AES-GCM", false, ["encrypt"]);
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(token)));
  return `${Array.from(iv, (b) => b.toString(16).padStart(2, "0")).join("")}.${Array.from(encrypted, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}
export async function decryptToken(value: string): Promise<string> {
  const [ivHex, dataHex] = value.split(".");
  if (!ivHex || !dataHex) throw new Error("Saved Notion access is invalid. Reconnect Notion.");
  const decode = (s: string) => Uint8Array.from(s.match(/../g) ?? [], (b) => parseInt(b, 16));
  const key = await crypto.subtle.importKey("raw", keyBytes(), "AES-GCM", false, ["decrypt"]);
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: decode(ivHex) }, key, decode(dataHex)));
}
export async function hashState(state: string): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(state))), (b) => b.toString(16).padStart(2, "0")).join("");
}
export function notionConfigured(): boolean {
  return !!(
    process.env.NOTION_CLIENT_ID &&
    process.env.NOTION_CLIENT_SECRET &&
    process.env.NOTION_REDIRECT_URI &&
    /^[a-f0-9]{64}$/i.test(process.env.NOTION_TOKEN_ENCRYPTION_KEY ?? "")
  );
}
