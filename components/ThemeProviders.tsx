"use client";

import type { ReactNode } from "react";
import { ThemeProvider } from "next-themes";

/**
 * Every page: just the theme. The landing, invitations, Privacy and Connect need nothing else, so
 * they don't download the sign-in, database or dialog code (see AppProviders).
 */
export function ThemeProviders({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange storageKey="max:theme">
      {children}
    </ThemeProvider>
  );
}

