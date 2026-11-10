"use client";

import { pageHref, pageIdFromPath } from "@/lib/pageUrl";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { useCall, useLocalLiveUpdates, useOp } from "@/lib/client/data";
import type { OpError } from "@/lib/client/errors";
import type { PageSummary, SettingsRow } from "@/lib/client/types";
import { pageTitle } from "@/lib/client/format";
import { readLocal, writeLocal } from "@/lib/client/storage";
import { confirmAction } from "@/components/ui";

export interface Identity {
  name: string;
  email: string | null;
  imageUrl: string | null;
  signOut: (() => Promise<void>) | null;
  deleteAccount: (() => Promise<void>) | null;
  manageAccount: (() => void) | null;
}

export type SettingsSection = "account" | "preferences" | "editor" | "sidebar" | "connections" | "data" | "shortcuts" | "about";

interface WorkspaceValue {
  tree: PageSummary[] | undefined;
  treeError: OpError | null;
  settings: SettingsRow | undefined;
  identity: Identity;
  byId: Map<string, PageSummary>;
  call: ReturnType<typeof useCall>;
  updateSettings: (patch: Partial<SettingsRow>) => Promise<void>;
  createPage: (opts?: { parentId?: string | null; title?: string; kind?: "page" | "database"; index?: number; open?: boolean }) => Promise<string | null>;
  archivePage: (id: string) => Promise<void>;
  duplicatePage: (id: string) => Promise<void>;
  toggleFavorite: (id: string, favorite: boolean) => Promise<void>;
  copyLink: (id: string) => void;
  expanded: Set<string>;
  setExpanded: (id: string, open: boolean) => void;
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  mobileNavOpen: boolean;
  setMobileNavOpen: (open: boolean) => void;
  searchOpen: boolean;
  setSearchOpen: (open: boolean) => void;
  openSettings: (section?: SettingsSection) => void;
  closeSettings: () => void;
  settingsSection: SettingsSection | null;
  moveTarget: string | null;
  setMoveTarget: (id: string | null) => void;
  importOpen: boolean;
  setImportOpen: (open: boolean) => void;
  importAsTemplates: boolean;
  setImportAsTemplates: (v: boolean) => void;
  /** Opens a page in side peek, center peek or full page (⌘/Ctrl-click always opens full page). */
  openPage: (id: string, opts?: { mode?: PeekMode; list?: string[]; event?: { metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean } }) => void;
  peek: { id: string; mode: "side" | "center" } | null;
  peekList: string[];
  closePeek: () => void;
  /** The page the keyboard shortcuts act on: the peeked page, else the open page. */
  activePageId: string | null;
  setActivePageId: (id: string | null) => void;
}

export type PeekMode = "side" | "center" | "full";

const Ctx = createContext<WorkspaceValue | null>(null);

export function useWorkspace() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWorkspace outside WorkspaceProvider");
  return v;
}

export function notifyError(err: unknown, fallback = "That didn't work. Try again.") {
  const message = (err as { message?: string })?.message || fallback;
  toast.error(message);
}

const SECTIONS: SettingsSection[] = ["account", "preferences", "editor", "sidebar", "connections", "data", "shortcuts", "about"];

export function WorkspaceProvider({ identity, children }: { identity: Identity; children: ReactNode }) {
  useLocalLiveUpdates();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const call = useCall();
  const { setTheme } = useTheme();
  const tree = useOp<{ pages: PageSummary[] }>("pages.tree", {});
  const settingsQ = useOp<{ settings: SettingsRow; saved: boolean }>("settings.get", {});
  const [optimisticSettings, setOptimisticSettings] = useState<Partial<SettingsRow>>({});
  const settings = useMemo(() => (settingsQ.data ? { ...settingsQ.data.settings, ...optimisticSettings } : undefined), [settingsQ.data, optimisticSettings]);

  // First sign-in: create preferences and a welcome page (idempotent on the server).
  const initRan = useRef(false);
  useEffect(() => {
    if (initRan.current || !settingsQ.data || settingsQ.data.settings.onboarded) return;
    initRan.current = true;
    call<{ welcomeId?: string | null }>("account.init", { displayName: identity.name !== "You" ? identity.name : null })
      .then((r) => {
        if (r.welcomeId && (pathname === "/home" || pathname === "/")) router.replace(`/p/${r.welcomeId}`);
      })
      .catch(() => {
        initRan.current = false;
      });
  }, [settingsQ.data, call, identity.name, pathname, router]);

  // Keep the theme, font and motion preferences applied.
  useEffect(() => {
    if (!settings) return;
    setTheme(settings.theme);
    document.documentElement.dataset.reduceMotion = settings.reduceMotion;
    document.documentElement.dataset.density = settings.density;
  }, [settings, setTheme]);

  const updateSettings = useCallback(
    async (patch: Partial<SettingsRow>) => {
      setOptimisticSettings((s) => ({ ...s, ...patch }));
      try {
        await call("settings.update", patch as Record<string, unknown>);
      } catch (err) {
        notifyError(err, "Couldn't save that preference. It's been put back.");
      } finally {
        setOptimisticSettings((s) => {
          const next = { ...s };
          for (const k of Object.keys(patch)) delete next[k as keyof SettingsRow];
          return next;
        });
      }
    },
    [call],
  );

  // Expansion state is per device (plan: persist per user/device), mirrored to settings for new devices.
  const [expanded, setExpandedState] = useState<Set<string>>(() => new Set(readLocal<string[]>("expanded", [])));
  const setExpanded = useCallback((id: string, open: boolean) => {
    setExpandedState((prev) => {
      const next = new Set(prev);
      if (open) next.add(id);
      else next.delete(id);
      writeLocal("expanded", [...next].slice(-1000));
      return next;
    });
  }, []);

  const [sidebarOpen, setSidebarOpenState] = useState(true);
  useEffect(() => setSidebarOpenState(readLocal("sidebarOpen", true)), []);
  const setSidebarOpen = useCallback((open: boolean) => {
    setSidebarOpenState(open);
    writeLocal("sidebarOpen", open);
  }, []);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  useEffect(() => setMobileNavOpen(false), [pathname]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [moveTarget, setMoveTarget] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importAsTemplates, setImportAsTemplates] = useState(false);
  const [peekList, setPeekList] = useState<string[]>([]);
  const [activePageId, setActivePageId] = useState<string | null>(null);
  const peekParam = params.get("peek");
  const peek = peekParam ? { id: peekParam, mode: (params.get("pm") === "center" ? "center" : "side") as "side" | "center" } : null;
  // Readable page links (/p/<title-words>-<id>); titles come from the sidebar tree.
  const titlesRef = useRef<Map<string, PageSummary>>(new Map());
  const hrefFor = useCallback((id: string) => pageHref(id, titlesRef.current.get(id)?.title), []);
  const openPage = useCallback<WorkspaceValue["openPage"]>(
    (id, { mode = "full", list, event } = {}) => {
      if (event?.metaKey || event?.ctrlKey) {
        window.open(hrefFor(id), "_blank", "noopener");
        return;
      }
      if (mode === "full" || event?.shiftKey) {
        router.push(hrefFor(id));
        return;
      }
      if (list) setPeekList(list);
      const sp = new URLSearchParams(params.toString());
      sp.set("peek", id);
      sp.set("pm", mode);
      router.push(`${pathname}?${sp.toString()}`, { scroll: false });
    },
    [hrefFor, params, pathname, router],
  );
  const closePeek = useCallback(() => {
    const sp = new URLSearchParams(params.toString());
    sp.delete("peek");
    sp.delete("pm");
    const q = sp.toString();
    router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
  }, [params, pathname, router]);

  const settingsParam = params.get("settings") as SettingsSection | null;
  const settingsSection = settingsParam && SECTIONS.includes(settingsParam) ? settingsParam : null;
  const openSettings = useCallback(
    (section: SettingsSection = "account") => {
      const sp = new URLSearchParams(params.toString());
      sp.set("settings", section);
      router.push(`${pathname}?${sp.toString()}`, { scroll: false });
    },
    [params, pathname, router],
  );
  const closeSettings = useCallback(() => {
    const sp = new URLSearchParams(params.toString());
    sp.delete("settings");
    const q = sp.toString();
    router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
  }, [params, pathname, router]);

  const byId = useMemo(() => new Map((tree.data?.pages ?? []).map((p) => [p._id, p])), [tree.data]);
  useEffect(() => {
    titlesRef.current = byId;
  }, [byId]);

  const createPage = useCallback<WorkspaceValue["createPage"]>(
    async ({ parentId = null, title, kind = "page", index, open = true } = {}) => {
      try {
        const res = kind === "database"
          ? await call<{ database: { _id: string } }>("databases.create", { parentId, title: title ?? "", index }).then((r) => r.database._id)
          : await call<{ page: { _id: string } }>("pages.create", { parentId, title: title ?? "", index }).then((r) => r.page._id);
        if (parentId) setExpanded(parentId, true);
        if (open) router.push(`${pageHref(res, title ?? "")}?new=1`);
        return res;
      } catch (err) {
        notifyError(err, "Couldn't create the page.");
        return null;
      }
    },
    [call, router, setExpanded],
  );

  const archivePage = useCallback(
    async (id: string) => {
      const page = byId.get(id);
      try {
        const res = await call<{ archived: number }>("pages.archive", { id });
        toast(`Moved “${pageTitle(page?.title)}”${res.archived > 1 ? ` and ${res.archived - 1} subpage${res.archived > 2 ? "s" : ""}` : ""} to trash`, {
          action: {
            label: "Undo",
            onClick: () => call("pages.restore", { id }).then(() => toast.success("Restored")).catch((e) => notifyError(e)),
          },
        });
        if (pageIdFromPath(pathname) === id) router.push(page?.parentId ? hrefFor(page.parentId) : "/home");
      } catch (err) {
        notifyError(err, "Couldn't move the page to trash.");
      }
    },
    [byId, call, hrefFor, pathname, router],
  );

  const duplicatePage = useCallback(
    async (id: string) => {
      const t = toast.loading("Duplicating…");
      try {
        const res = await call<{ id: string; copied: number }>("pages.duplicate", { id });
        toast.success(res.copied > 1 ? `Duplicated with ${res.copied - 1} subpage${res.copied > 2 ? "s" : ""}` : "Duplicated", {
          id: t,
          action: { label: "Open", onClick: () => router.push(hrefFor(res.id)) },
        });
      } catch (err) {
        toast.dismiss(t);
        notifyError(err, "Couldn't duplicate the page.");
      }
    },
    [call, hrefFor, router],
  );

  const toggleFavorite = useCallback(
    async (id: string, favorite: boolean) => {
      try {
        await call("pages.setFavorite", { id, favorite });
        toast.success(favorite ? "Added to Favorites" : "Removed from Favorites");
      } catch (err) {
        notifyError(err);
      }
    },
    [call],
  );

  const copyLink = useCallback((id: string) => {
    const url = `${window.location.origin}${hrefFor(id)}`;
    navigator.clipboard
      .writeText(url)
      .then(() => toast.success("Link copied. It opens only for you."))
      .catch(() => toast.error("Couldn't copy. Your browser blocked clipboard access."));
  }, [hrefFor]);

  // Global shortcuts (the full list lives in lib/client/shortcuts.ts).
  const shortcutState = useRef({ byId, activePageId: null as string | null });
  shortcutState.current = { byId, activePageId: peekParam ?? activePageId };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      const { byId: pages, activePageId: current } = shortcutState.current;
      const run = (fn: () => void) => {
        e.preventDefault();
        fn();
      };
      if (!e.shiftKey && !e.altKey && key === "k" && !window.getSelection()?.toString()) return run(() => setSearchOpen(true));
      if (key === "\\") return run(() => setSidebarOpen(!sidebarOpen));
      if (e.altKey && (key === "n" || e.code === "KeyN")) return run(() => void createPage());
      if (!e.shiftKey && key === ",") return run(() => openSettings("preferences"));
      if (!e.shiftKey && key === "/") return run(() => openSettings("shortcuts"));
      if (!e.shiftKey && !e.altKey && key === "[") return run(() => router.back());
      if (!e.shiftKey && !e.altKey && key === "]") return run(() => router.forward());
      if (e.shiftKey && !e.altKey) {
        if (key === "l") return run(() => void updateSettings({ theme: document.documentElement.classList.contains("dark") ? "light" : "dark" }));
        if (key === "i") return run(() => (setImportAsTemplates(false), setImportOpen(true)));
        if (key === "t") return run(() => router.push("/templates"));
        if (key === "g") return run(() => router.push("/graph"));
      }
      if (!current) return;
      const page = pages.get(current);
      if (e.shiftKey && !e.altKey) {
        if (key === "u") return run(() => (page?.parentId ? router.push(hrefFor(page.parentId)) : router.push("/home")));
        if (key === "f") return run(() => void toggleFavorite(current, !page?.favoriteRank));
        if (key === "d") return run(() => void duplicatePage(current));
        if (key === "p") return run(() => setMoveTarget(current));
        if (key === "y") return run(() => document.dispatchEvent(new CustomEvent("max:page-action", { detail: { pageId: current, action: "history" } })));
        if (key === "e") return run(() => document.dispatchEvent(new CustomEvent("max:page-action", { detail: { pageId: current, action: "export" } })));
        if (key === "backspace" || key === "delete") return run(() => void archivePage(current));
      }
      if (e.altKey && !e.shiftKey && (key === "l" || e.code === "KeyL")) return run(() => copyLink(current));
      if (e.altKey && !e.shiftKey && (key === "g" || e.code === "KeyG")) return run(() => document.dispatchEvent(new CustomEvent("max:page-action", { detail: { pageId: current, action: "graph" } })));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [archivePage, copyLink, createPage, duplicatePage, hrefFor, openSettings, router, setSidebarOpen, sidebarOpen, toggleFavorite, updateSettings]);

  const value: WorkspaceValue = {
    tree: tree.data?.pages,
    treeError: tree.error,
    settings,
    identity,
    byId,
    call,
    updateSettings,
    createPage,
    archivePage,
    duplicatePage,
    toggleFavorite,
    copyLink,
    expanded,
    setExpanded,
    sidebarOpen,
    setSidebarOpen,
    mobileNavOpen,
    setMobileNavOpen,
    searchOpen,
    setSearchOpen,
    openSettings,
    closeSettings,
    settingsSection,
    moveTarget,
    setMoveTarget,
    importOpen,
    setImportOpen,
    importAsTemplates,
    setImportAsTemplates,
    openPage,
    peek,
    peekList,
    closePeek,
    activePageId: peek?.id ?? activePageId,
    setActivePageId,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export async function confirmPermanentDelete(title: string, extra?: string) {
  return confirmAction({
    title: "Delete permanently?",
    body: (
      <p>
        <strong className="text-fg">“{title}”</strong> {extra ?? "and everything inside it"} will be deleted for good, including uploaded images. This can't be undone.
      </p>
    ),
    confirmLabel: "Delete permanently",
    tone: "danger",
  });
}
