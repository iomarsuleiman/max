"use client";

import type { ReactNode } from "react";
import { useTheme } from "next-themes";
import { Tooltip } from "radix-ui";
import { Toaster } from "sonner";
import { ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { useAuth } from "@clerk/nextjs";
import { CLOUD, CONVEX_URL } from "@/lib/config";
import { DoodleDefs } from "@/components/icons/Doodle";
import { ConfirmHost } from "@/components/ui";

const convex = CLOUD ? new ConvexReactClient(CONVEX_URL) : null;

function ThemedToaster() {
  const { resolvedTheme } = useTheme();
  return (
    <Toaster
      theme={resolvedTheme === "dark" ? "dark" : "light"}
      position="bottom-right"
      closeButton
      toastOptions={{
        style: { background: "var(--overlay)", color: "var(--fg)", border: "0", boxShadow: "var(--shadow-pop)", fontSize: 13 },
        actionButtonStyle: { background: "var(--accent)", color: "var(--accent-fg)" },
      }}
    />
  );
}

/** The app's pages (workspace, shared and published pages, sign-in): data, tooltips, toasts, dialogs. */
export function AppProviders({ children }: { children: ReactNode }) {
  const inner = (
    <Tooltip.Provider delayDuration={400} skipDelayDuration={200}>
      <DoodleDefs />
      {children}
      <ThemedToaster />
      <ConfirmHost />
    </Tooltip.Provider>
  );
  if (convex) {
    return (
      <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
        {inner}
      </ConvexProviderWithClerk>
    );
  }
  return inner;
}
