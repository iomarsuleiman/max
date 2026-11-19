"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { ShareLevel } from "@/lib/domain/types";

/** What you can do on the page in front of you. Owners get "owner"; shared pages get a level. */
export interface PageAccess {
  level: ShareLevel | "owner";
  shared: boolean;
  /** Your account id (to tell your comments apart), when known. */
  you?: string;
  /** The page owner's display name, on pages shared with you. */
  ownerName?: string | null;
  /** Visiting through a link: the page (or teamspace) you can join, so it stays in your sidebar. */
  invite?: { pageId: string; title: string; icon: string | null; teamspace: boolean } | null;
}

const OWNER: PageAccess = { level: "owner", shared: false };
const Ctx = createContext<PageAccess>(OWNER);

export function PageAccessProvider({ value, children }: { value: PageAccess; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const usePageAccess = () => useContext(Ctx);

const RANK = { view: 0, comment: 1, edit: 2, full_access: 3, owner: 4 } as const;
export const can = (access: PageAccess, min: ShareLevel) => RANK[access.level] >= RANK[min];

const KEY = "max:share-link";

/**
 * "Anyone with the link" tokens arrive as ?share=… on a page URL. The latest one is kept for the
 * tab so sub-pages opened from that page keep working; the server only honours it for pages
 * under the linked page.
 */
export function useLinkToken(): string | null {
  const [token, setToken] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    const fromUrl = new URLSearchParams(window.location.search).get("share");
    if (fromUrl && /^[a-f0-9]{16,64}$/.test(fromUrl)) return fromUrl;
    try {
      return sessionStorage.getItem(KEY);
    } catch {
      return null;
    }
  });
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("share");
    if (fromUrl && /^[a-f0-9]{16,64}$/.test(fromUrl)) {
      try {
        sessionStorage.setItem(KEY, fromUrl);
      } catch {}
      if (fromUrl !== token) setToken(fromUrl);
    }
  }, [token]);
  return token;
}
