"use client";
import { OfflineNotice } from "@/components/feedback/OfflineSupport";

import { Suspense, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Dialog as D } from "radix-ui";
import { useConvexAuth } from "convex/react";
import { useClerk, useUser } from "@clerk/nextjs";
import { CLOUD } from "@/lib/config";
import { isWorkspacePreviewRoute } from "@/lib/domain/workspaceNavigationState";
import { LogoMark } from "@/components/brand/Logo";
import { cardPalette } from "@/lib/domain/profileCard";
import { setDatePrefs } from "@/lib/client/datePrefs";
import { applySpace, clearSpace } from "@/lib/client/space";
import { Button, cn } from "@/components/ui";
import { WorkspaceProvider, useWorkspace, type Identity } from "./context";
import { Sidebar } from "./Sidebar";
import { WorkspaceRail, WorkspacePreviewSidebar, WORKSPACE_NAVIGATION_PREVIEW } from "./WorkspaceRail";
import { SearchDialog } from "./SearchDialog";
import dynamic from "next/dynamic";
import { ProfileCardInvitation } from "@/components/profile/ProfileCardInvitation";

// Heavy dialogs load on first use and stay mounted afterwards, so closing still animates.
const SettingsDialog = dynamic(() => import("@/components/settings/SettingsDialog").then((m) => m.SettingsDialog), { ssr: false });
const MoveDialog = dynamic(() => import("./MoveDialog").then((m) => m.MoveDialog), { ssr: false });
const ImportDialog = dynamic(() => import("@/components/import/ImportDialog").then((m) => m.ImportDialog), { ssr: false });
const PeekHost = dynamic(() => import("./Peek").then((m) => m.PeekHost), { ssr: false });

function useEverTrue(flag: boolean) {
  const [ever, setEver] = useState(flag);
  if (flag && !ever) setEver(true);
  return ever || flag;
}

function Splash({ message = "Opening your workspace…" }: { message?: string }) {
  return (
    <div className="grid min-h-dvh place-items-center bg-canvas" role="status" aria-live="polite">
      <div className="flex flex-col items-center gap-4 text-fg-3">
        <LogoMark className="size-9 animate-pulse text-fg-2" />
        <p className="text-[13px]">{message}</p>
      </div>
    </div>
  );
}

const LOCAL_IDENTITY: Identity = { name: "You", email: null, imageUrl: null, signOut: null, deleteAccount: null, manageAccount: null };

function CloudGate({ children }: { children: (identity: Identity) => ReactNode }) {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const { user, isLoaded, isSignedIn } = useUser();
  const clerk = useClerk();
  const router = useRouter();
  useEffect(() => {
    if (isLoaded && !isSignedIn) router.replace("/sign-in");
  }, [isLoaded, isSignedIn, router]);
  if (!isLoaded || isLoading) return <Splash />;
  if (!isSignedIn) return <Splash message="Taking you to sign in…" />;
  if (!isAuthenticated) {
    return (
      <div className="grid min-h-dvh place-items-center bg-canvas px-4">
        <div className="max-w-sm text-center">
          <h1 className="text-[15px] font-semibold">We couldn&apos;t confirm your session</h1>
          <p className="mt-2 text-[13px] text-fg-2">You&apos;re signed in, but Max&apos;s data service didn&apos;t accept the session. Reload the page; if this keeps happening, sign out and back in.</p>
          <div className="mt-4 flex justify-center gap-2">
            <Button onClick={() => location.reload()}>Reload</Button>
            <Button variant="ghost" onClick={() => clerk.signOut({ redirectUrl: "/" })}>
              Sign out
            </Button>
          </div>
        </div>
      </div>
    );
  }
  const identity: Identity = {
    name: user.fullName || user.firstName || user.username || user.primaryEmailAddress?.emailAddress?.split("@")[0] || "You",
    email: user.primaryEmailAddress?.emailAddress ?? null,
    imageUrl: user.hasImage ? user.imageUrl : null,
    signOut: () => clerk.signOut({ redirectUrl: "/" }),
    deleteAccount: async () => {
      await user.delete();
      await clerk.signOut({ redirectUrl: "/" });
    },
    manageAccount: () => clerk.openUserProfile(),
  };
  return <>{children(identity)}</>;
}

const noop = () => () => {};
/** The workspace is per-device and per-account, so it renders only in the browser. */
function useMounted() {
  return useSyncExternalStore(noop, () => true, () => false);
}

export function WorkspaceShell({ children }: { children: ReactNode }) {
  const mounted = useMounted();
  if (!mounted) return <Splash />;
  return <WorkspaceRoot>{children}</WorkspaceRoot>;
}

function WorkspaceRoot({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isPreview = WORKSPACE_NAVIGATION_PREVIEW && isWorkspacePreviewRoute(pathname);
  const inner = (identity: Identity) => (
    <Suspense fallback={<Splash />}>
      {isPreview ? (
        <WorkspacePreviewFrame>{children}</WorkspacePreviewFrame>
      ) : (
        <WorkspaceProvider identity={identity}>
          <Frame>{children}</Frame>
        </WorkspaceProvider>
      )}
    </Suspense>
  );
  return CLOUD ? <CloudGate>{inner}</CloudGate> : inner(LOCAL_IDENTITY);
}

/** Preview paths cannot mount personal data providers, editors or search. */
function WorkspacePreviewFrame({ children }: { children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  return (
    <div className="max-workspace-frame flex h-dvh overflow-hidden bg-canvas">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:start-3 focus:top-3 focus:z-[90] focus:rounded-md focus:bg-overlay focus:px-3 focus:py-2">
        Skip to content
      </a>
      <WorkspaceRail />
      <div className="hidden md:flex"><WorkspacePreviewSidebar /></div>
      <D.Root open={mobileOpen} onOpenChange={setMobileOpen}>
        <D.Portal>
          <D.Overlay className="fixed inset-0 z-[55] bg-[var(--scrim)] md:hidden" />
          <D.Content className="fixed inset-y-0 start-0 z-[56] flex w-[min(86vw,320px)] shadow-dialog outline-none md:hidden" aria-describedby={undefined}>
            <D.Title className="sr-only">Workspace navigation</D.Title>
            <WorkspacePreviewSidebar />
            <D.Close className="absolute end-2 top-2 grid size-11 place-items-center rounded-md text-xs text-fg-2 hover:bg-hover focus-visible:outline-2 focus-visible:outline-accent" aria-label="Close workspace navigation">
              Close
            </D.Close>
          </D.Content>
        </D.Portal>
      </D.Root>
      <main id="main" tabIndex={-1} className="relative flex min-h-0 min-w-0 flex-1 flex-col outline-none">
        <div className="border-b border-line px-3 py-2 pt-[max(8px,env(safe-area-inset-top))] md:hidden">
          <button type="button" onClick={() => setMobileOpen(true)} aria-haspopup="dialog" aria-expanded={mobileOpen}
            className="min-h-11 rounded-md border border-line px-4 text-[13px] text-fg hover:bg-hover focus-visible:outline-2 focus-visible:outline-accent">
            Workspaces
          </button>
        </div>
        {children}
      </main>
    </div>
  );
}

/** Tints your space with your membership card's colors (Arc-style), remembered for the next visit. */
function useSpaceTint(theme: string | undefined, custom: { colors: string[]; grain: number; intensity: number } | null) {
  useEffect(() => {
    if (custom) {
      applySpace(custom);
      return;
    }
    clearSpace();
    let t = theme;
    try {
      if (t) localStorage.setItem("max:space-tint", t);
      else t = localStorage.getItem("max:space-tint") ?? undefined;
    } catch {
      // Storage can be unavailable; the default tint still applies.
    }
    const palette = cardPalette(t ?? "sunset");
    document.documentElement.style.setProperty("--tint-1", palette.first);
    document.documentElement.style.setProperty("--tint-2", palette.second);
  }, [theme, custom]);
}


function Frame({ children }: { children: ReactNode }) {
  const ws = useWorkspace();
  const s = ws.settings;
  // Your space takes your card's colors unless you picked a palette or made your own in Preferences.
  useSpaceTint(s?.spaceColor && s.spaceColor !== "card" ? s.spaceColor : (s?.profileCard as { theme?: string } | undefined)?.theme, s?.space ?? null);
  useEffect(() => {
    const root = document.documentElement;
    if (s?.accent && s.accent !== "blue") root.dataset.accent = s.accent;
    else delete root.dataset.accent;
  }, [s?.accent]);
  setDatePrefs({ dateFormat: s?.dateFormat, timeFormat: s?.timeFormat, weekStart: s?.weekStart });
  // Get the emoji list ready while nothing else is happening, so the icon picker opens instantly.
  useEffect(() => {
    const idle = (window as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    const run = () => void import("@/components/page/IconPicker").then((m) => m.preloadEmojiData()).catch(() => undefined);
    const id = idle ? idle(run, { timeout: 6000 }) : window.setTimeout(run, 3000);
    return () => {
      if (!idle) window.clearTimeout(id);
    };
  }, []);
  const pathname = usePathname();
  const preview = WORKSPACE_NAVIGATION_PREVIEW && isWorkspacePreviewRoute(pathname);
  return (
    <div className="max-workspace-frame max-space flex h-dvh overflow-hidden" data-font={ws.settings?.font}>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:start-3 focus:top-3 focus:z-[90] focus:rounded-md focus:bg-overlay focus:px-3 focus:py-2 focus:shadow-pop">
        Skip to content
      </a>
      {WORKSPACE_NAVIGATION_PREVIEW && <WorkspaceRail />}
      <div className={cn("hidden md:flex", !ws.sidebarOpen && "md:hidden")}>
        {preview ? <WorkspacePreviewSidebar /> : <Sidebar />}
      </div>
      <D.Root open={ws.mobileNavOpen} onOpenChange={ws.setMobileNavOpen}>
        <D.Portal>
          <D.Overlay className="fixed inset-0 z-[55] bg-[var(--scrim)] md:hidden [animation:max-fade_150ms_ease]" />
          <D.Content className="fixed inset-y-0 start-0 z-[56] flex shadow-dialog outline-none md:hidden [animation:max-in_180ms_var(--ease)]" aria-describedby={undefined}>
            <D.Title className="sr-only">Navigation</D.Title>
            {preview ? <WorkspacePreviewSidebar /> : <Sidebar mobile />}
          </D.Content>
        </D.Portal>
      </D.Root>
      <main id="main" className="max-panel relative flex min-w-0 flex-1 flex-col" data-alone={!ws.sidebarOpen || undefined}>
        <OfflineNotice />
        {children}
      </main>
      {!preview && <SearchDialog />}
      {!preview && <ProfileCardInvitation />}
      {!preview && <LazyDialogs />}
    </div>
  );
}

function LazyDialogs() {
  const ws = useWorkspace();
  const settings = useEverTrue(!!ws.settingsSection);
  const move = useEverTrue(!!ws.moveTarget);
  const importer = useEverTrue(ws.importOpen);
  const peek = useEverTrue(!!ws.peek);
  return (
    <>
      {settings && <SettingsDialog />}
      {move && <MoveDialog />}
      {importer && <ImportDialog />}
      {peek && <PeekHost />}
    </>
  );
}
