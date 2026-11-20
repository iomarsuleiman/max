"use client";

import { useCallback } from "react";
import { useCall, useRead } from "./data";

const urlCache = new Map<string, { url: string; at: number }>();

/** Upload flow shared by the editor and covers: get an upload URL, POST the file, register it. */
export function useUploader() {
  const call = useCall();
  return useCallback(
    async (file: File, pageId: string | null, alt = ""): Promise<string> => {
      const type = file.type || "application/octet-stream";
      const start = await call<{ uploadUrl: string; method?: "PUT"; headers?: Record<string, string>; storageId?: string }>("assets.createUploadUrl", { type, size: file.size });
      let storageId: string;
      if (start.method === "PUT" && start.storageId) {
        // Straight to Cloudflare R2 with a signed link: the file never passes through Max's servers.
        const res = await fetch(start.uploadUrl, { method: "PUT", headers: start.headers ?? { "Content-Type": type }, body: file });
        if (!res.ok) throw new Error("The upload didn't finish. Check your connection and try again.");
        storageId = start.storageId;
      } else {
        const res = await fetch(start.uploadUrl, { method: "POST", headers: { "Content-Type": type }, body: file });
        if (!res.ok) throw new Error(res.status === 413 ? `“${file.name}” is too large.` : "The upload didn't finish. Check your connection and try again.");
        storageId = ((await res.json()) as { storageId: string }).storageId;
      }
      const { url } = await call<{ url: string }>("assets.register", { storageId, pageId, name: file.name || "image", type: file.type, size: file.size, alt });
      return url;
    },
    [call],
  );
}

/** Turns max-asset://<id> into a loadable URL for the owner; other URLs pass through. */
export function useAssetResolver() {
  const read = useRead();
  return useCallback(
    async (url: string): Promise<string> => {
      if (!url.startsWith("max-asset://")) return url;
      const id = url.slice("max-asset://".length);
      const hit = urlCache.get(id);
      if (hit && Date.now() - hit.at < 30 * 60_000) return hit.url;
      try {
        const res = await read<{ url: string }>("assets.getUrl", { id });
        urlCache.set(id, { url: res.url, at: Date.now() });
        return res.url;
      } catch {
        return "";
      }
    },
    [read],
  );
}
