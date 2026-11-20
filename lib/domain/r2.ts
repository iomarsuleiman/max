/**
 * Cloudflare R2 (S3-compatible) presigned URLs, made with Web Crypto so they work in Convex, the
 * server and tests alike. The browser uploads straight to R2 with a signed PUT (no file passes
 * through Max's servers), and files are read through signed GET links that expire.
 *
 * Configure in Convex (npx convex env set …): R2_ACCOUNT_ID, R2_ACCESS_KEY_ID,
 * R2_SECRET_ACCESS_KEY, R2_BUCKET. Without them, files stay in Convex storage as before.
 */

export interface R2Config {
  endpoint: string; // https://<account>.r2.cloudflarestorage.com (or any S3 endpoint, for tests)
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region?: string; // R2 uses "auto"
}

export const R2_PREFIX = "r2:";

export function r2ConfigFromEnv(env: Record<string, string | undefined>): R2Config | null {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = env;
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET) return null;
  return { endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, bucket: R2_BUCKET, accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY, region: "auto" };
}

const enc = new TextEncoder();
const hex = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
const sha256 = async (text: string) => hex(await crypto.subtle.digest("SHA-256", enc.encode(text)));
async function hmac(key: ArrayBuffer | Uint8Array, text: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey("raw", key as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", k, enc.encode(text));
}
/** RFC 3986 encoding, as SigV4 wants (slashes kept in paths). */
const uri = (s: string, keepSlash = false) =>
  encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`).replace(keepSlash ? /%2F/g : /$^/, "/");

/**
 * A presigned URL (AWS Signature V4, query-string auth). `headers` are signed too and must be sent
 * as-is (e.g. content-type and content-length for an upload, so the size can't be swapped).
 */
export async function presign(
  cfg: R2Config,
  method: "GET" | "PUT" | "DELETE",
  key: string,
  opts: { now: number; expires: number; headers?: Record<string, string>; virtualHost?: boolean },
): Promise<string> {
  const region = cfg.region ?? "auto";
  const date = new Date(opts.now).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const day = date.slice(0, 8);
  const endpoint = new URL(cfg.endpoint);
  const host = opts.virtualHost ? `${cfg.bucket}.${endpoint.host}` : endpoint.host;
  const path = opts.virtualHost ? `/${uri(key, true)}` : `/${uri(cfg.bucket)}/${uri(key, true)}`;
  const headers: Record<string, string> = { host, ...Object.fromEntries(Object.entries(opts.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v.trim()])) };
  const signedHeaders = Object.keys(headers).sort().join(";");
  const scope = `${day}/${region}/s3/aws4_request`;
  const query: Record<string, string> = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${cfg.accessKeyId}/${scope}`,
    "X-Amz-Date": date,
    "X-Amz-Expires": String(opts.expires),
    "X-Amz-SignedHeaders": signedHeaders,
  };
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((k) => `${uri(k)}=${uri(query[k])}`)
    .join("&");
  const canonicalHeaders = Object.keys(headers)
    .sort()
    .map((k) => `${k}:${headers[k]}\n`)
    .join("");
  const canonical = [method, path, canonicalQuery, canonicalHeaders, signedHeaders, "UNSIGNED-PAYLOAD"].join("\n");
  const toSign = ["AWS4-HMAC-SHA256", date, scope, await sha256(canonical)].join("\n");
  let k = await hmac(enc.encode(`AWS4${cfg.secretAccessKey}`), day);
  for (const part of [region, "s3", "aws4_request"]) k = await hmac(k, part);
  const signature = hex(await hmac(k, toSign));
  return `${endpoint.protocol}//${host}${path}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

/** A short, one-way tag for an account: binds an R2 file to whoever uploaded it, without naming them. */
export const ownerTag = async (account: string) => (await sha256(`max-owner:${account}`)).slice(0, 16);

/** A fresh, unguessable object key for an upload: u/<owner tag>/<random>.<ext>. */
export async function newObjectKey(account: string, type: string): Promise<string> {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const id = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  const ext = /^image\/(png|jpeg|gif|webp|avif|svg\+xml)$/.exec(type)?.[1]?.replace("jpeg", "jpg").replace("svg+xml", "svg");
  return `u/${await ownerTag(account)}/${id}${ext ? `.${ext}` : ""}`;
}

/** Whether an R2 key was issued to this account (so nobody can claim, then delete, someone else's file). */
export async function keyBelongsTo(key: string, account: string): Promise<boolean> {
  return key.startsWith(`u/${await ownerTag(account)}/`);
}
