"use client";

import { useCallback } from "react";
import { useCall, useRead } from "./data";

const urlCache = new Map<string, { url: string; at: number }>();

/** Upload flow shared by the editor and covers: get an upload URL, POST the file, register it. */
export function useUploader() {
  const call = useCall();
  return useCallback(
    async (file: File, pageId: string | null, alt = ""): Promise<string> => {
      const { uploadUrl } = await call<{ uploadUrl: string }>("assets.createUploadUrl", {});
      const res = await fetch(uploadUrl, { method: "POST", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file });
      if (!res.ok) throw new Error(res.status === 413 ? `“${file.name}” is larger than 50 MB.` : "The upload didn't finish. Check your connection and try again.");
      const { storageId } = (await res.json()) as { storageId: string };
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
