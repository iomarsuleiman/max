"use client";

import { Suspense, useEffect, useSyncExternalStore, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Dialog as D } from "radix-ui";
import { useConvexAuth } from "convex/react";
import { useClerk, useUser } from "@clerk/nextjs";
import { CLOUD } from "@/lib/config";
import { LogoMark } from "@/components/brand/Logo";
import { Button, cn } from "@/components/ui";
import { WorkspaceProvider, useWorkspace, type Identity } from "./context";
import { Sidebar } from "./Sidebar";
import { SearchDialog } from "./SearchDialog";
import { SettingsDialog } from "@/components/settings/SettingsDialog";
import { MoveDialog } from "./MoveDialog";
import { ImportDialog } from "@/components/import/ImportDialog";

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
  const inner = (identity: Identity) => (
    <Suspense fallback={<Splash />}>
      <WorkspaceProvider identity={identity}>
        <Frame>{children}</Frame>
      </WorkspaceProvider>
    </Suspense>
  );
  return CLOUD ? <CloudGate>{inner}</CloudGate> : inner(LOCAL_IDENTITY);
}

function Frame({ children }: { children: ReactNode }) {
  const ws = useWorkspace();
  return (
    <div className="flex h-dvh overflow-hidden bg-canvas" data-font={ws.settings?.font}>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:start-3 focus:top-3 focus:z-[90] focus:rounded-md focus:bg-overlay focus:px-3 focus:py-2 focus:shadow-pop">
        Skip to content
      </a>
      <div className={cn("hidden md:flex", !ws.sidebarOpen && "md:hidden")}>
        <Sidebar />
      </div>
      <D.Root open={ws.mobileNavOpen} onOpenChange={ws.setMobileNavOpen}>
        <D.Portal>
          <D.Overlay className="fixed inset-0 z-[55] bg-[var(--scrim)] md:hidden [animation:max-fade_150ms_ease]" />
          <D.Content className="fixed inset-y-0 start-0 z-[56] flex shadow-dialog outline-none md:hidden [animation:max-in_180ms_var(--ease)]" aria-describedby={undefined}>
            <D.Title className="sr-only">Navigation</D.Title>
            <Sidebar mobile />
          </D.Content>
        </D.Portal>
      </D.Root>
      <main id="main" className="relative flex min-w-0 flex-1 flex-col">
        {children}
      </main>
      <SearchDialog />
      <SettingsDialog />
      <MoveDialog />
      <ImportDialog />
    </div>
  );
}
