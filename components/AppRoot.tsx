import type { ReactNode } from "react";
import { ClerkProvider } from "@clerk/nextjs";
import { CLOUD } from "@/lib/config";
import { AppProviders } from "@/components/providers";

const clerkAppearance = {
  variables: { colorPrimary: "#3c6ea8", borderRadius: "8px", fontFamily: "var(--font-sans)" },
};

/**
 * Sign-in and data for the parts of Max that need them (workspace, sign-in, shared and published
 * pages). Public marketing pages skip all of it and stay light.
 */
export function AppRoot({ children }: { children: ReactNode }) {
  const app = <AppProviders>{children}</AppProviders>;
  return CLOUD ? (
    <ClerkProvider appearance={clerkAppearance} signInUrl="/sign-in" signUpUrl="/sign-up" signInFallbackRedirectUrl="/home" signUpFallbackRedirectUrl="/home">
      {app}
    </ClerkProvider>
  ) : (
    app
  );
}
