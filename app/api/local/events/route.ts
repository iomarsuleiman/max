import { CLOUD } from "@/lib/config";
import { localEvents, localModeAllowed } from "@/lib/server/local";

export const dynamic = "force-dynamic";

/** Server-sent events so open tabs refresh when another tab or an assistant changes data. */
export async function GET(request: Request) {
  if (CLOUD || !localModeAllowed()) return new Response("Not found", { status: 404 });
  const events = localEvents();
  const encoder = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream({
    start(controller) {
      const send = (data: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      const onChange = (e: unknown) => send(e);
      const ping = setInterval(() => controller.enqueue(encoder.encode(": ping\n\n")), 25_000);
      events.on("change", onChange);
      send({ op: "hello" });
      cleanup = () => {
        clearInterval(ping);
        events.off("change", onChange);
      };
      request.signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {}
      });
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" } });
}
