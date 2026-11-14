import { describe, expect, it } from "vitest";
import { readUploadBody } from "@/lib/domain/uploadBody";

function streamRequest(chunks: string[], headers: Record<string, string> = {}) {
  let cancelled = false;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
    },
    cancel() {
      cancelled = true;
    },
  });
  const init: RequestInit & { duplex: "half" } = { method: "POST", headers: { "content-type": "text/plain", ...headers }, body: stream, duplex: "half" };
  return { request: new Request("https://upload.invalid", init), cancelled: () => cancelled };
}

describe("bounded received upload bytes", () => {
  it("retains binary bytes and normalizes the received MIME type", async () => {
    const request = new Request("https://upload.invalid", {
      method: "POST",
      headers: { "content-type": "Text/Plain; charset=utf-8" },
      body: new Uint8Array([0, 128, 255]),
    });
    const blob = await readUploadBody(request, 3);
    expect(blob.type).toBe("text/plain");
    expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([0, 128, 255]);
  });
  it("rejects oversized chunks even when declared length is smaller and cancels the source", async () => {
    const f = streamRequest(["ab", "cd"], { "content-length": "1" });
    await expect(readUploadBody(f.request, 3)).rejects.toMatchObject({ code: "LIMIT" });
    expect(f.cancelled()).toBe(true);
  });
  it("rejects missing-length oversized streams before reading the rest", async () => {
    const f = streamRequest(["abcd", "more"]);
    await expect(readUploadBody(f.request, 3)).rejects.toMatchObject({ code: "LIMIT" });
    expect(f.cancelled()).toBe(true);
  });
  it("rejects unsupported MIME, malformed and excessive declared length", async () => {
    const cases: Record<string, string>[] = [{ "content-type": "application/unsupported" }, { "content-length": "-1" }, { "content-length": "999" }];
    for (const headers of cases) {
      const request = new Request("https://upload.invalid", { method: "POST", body: "a", headers });
      await expect(readUploadBody(request, 3)).rejects.toMatchObject({ code: headers["content-length"] === "999" ? "LIMIT" : "VALIDATION" });
    }
  });
  it("rejects empty bodies", async () => {
    await expect(
      readUploadBody(new Request("https://upload.invalid", { method: "POST", headers: { "content-type": "text/plain" }, body: "" })),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });
});
