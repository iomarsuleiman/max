import { CLOUD } from "@/lib/config";
import { localModeAllowed, readLocalFile } from "@/lib/server/local";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (CLOUD || !localModeAllowed()) return new Response("Not found", { status: 404 });
  const file = await readLocalFile((await params).id);
  if (!file) return new Response("Not found", { status: 404 });
  // Images, audio, video and PDFs display inline (sandboxed); everything else downloads.
  const inline = /^(image|audio|video)\//.test(file.type) || file.type === "application/pdf";
  return new Response(new Uint8Array(file.body), {
    headers: {
      "Content-Type": inline ? file.type : "application/octet-stream",
      ...(inline ? {} : { "Content-Disposition": "attachment" }),
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
