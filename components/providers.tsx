"use client";

import type { ReactNode } from "react";
import { ThemeProvider, useTheme } from "next-themes";
import { Tooltip } from "radix-ui";
import { Toaster } from "sonner";
import { ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { useAuth } from "@clerk/nextjs";
import { CLOUD, CONVEX_URL } from "@/lib/config";
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

export function Providers({ children }: { children: ReactNode }) {
  const inner = (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange storageKey="max:theme">
      <Tooltip.Provider delayDuration={400} skipDelayDuration={200}>
        {children}
        <ThemedToaster />
        <ConfirmHost />
      </Tooltip.Provider>
    </ThemeProvider>
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
