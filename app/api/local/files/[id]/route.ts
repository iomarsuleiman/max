import { CLOUD } from "@/lib/config";
import { localModeAllowed, readLocalFile } from "@/lib/server/local";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (CLOUD || !localModeAllowed()) return new Response("Not found", { status: 404 });
  const file = await readLocalFile((await params).id);
  if (!file) return new Response("Not found", { status: 404 });
  const safeType = file.type.startsWith("image/") && file.type !== "image/svg+xml" ? file.type : "application/octet-stream";
  return new Response(new Uint8Array(file.body), {
    headers: { "Content-Type": file.type === "image/svg+xml" ? "image/svg+xml" : safeType, "Cache-Control": "private, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox" },
  });
}
