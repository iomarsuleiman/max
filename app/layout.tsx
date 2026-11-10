import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Inter, Cairo } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { APP_URL, CLERK_KEY, CLOUD, CONVEX_URL } from "@/lib/config";
import { Providers } from "@/components/providers";
import { WebVitals } from "@/components/WebVitals";
import { OfflineRegistration } from "@/components/feedback/OfflineSupport";
import "./globals.css";
import "@/components/editor/editor.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
// Arabic loads only when Arabic text appears (its unicode-range), not on every first paint.
const cairo = Cairo({ subsets: ["arabic"], variable: "--font-arabic", display: "swap", preload: false });

export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  title: { default: "Max", template: "%s · Max" },
  description: "A calm, private workspace for notes, nested pages and personal databases.",
  applicationName: "Max",
  openGraph: { title: "Max", description: "Your notes, pages and databases. Private by default.", url: APP_URL, siteName: "Max", type: "website" },
  twitter: { card: "summary_large_image", title: "Max", description: "Your notes, pages and databases. Private by default." },
  manifest: "/manifest.webmanifest",
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8f7f4" },
    { media: "(prefers-color-scheme: dark)", color: "#1b1c20" },
  ],
};

const clerkAppearance = {
  variables: { colorPrimary: "#3c6ea8", borderRadius: "8px", fontFamily: "var(--font-sans)" },
};

/** Clerk's frontend API host is encoded in the publishable key ("pk_live_<base64 of host$>"). */
function clerkOrigin(key: string): string | null {
  try {
    const host = atob(key.split("_")[2] ?? "").replace(/\$$/, "");
    return /^[a-z0-9.-]+$/i.test(host) ? `https://${host}` : null;
  } catch {
    return null;
  }
}

const EARLY_ORIGINS = CLOUD ? [CONVEX_URL && new URL(CONVEX_URL).origin, clerkOrigin(CLERK_KEY)].filter((o): o is string => !!o) : [];

export default function RootLayout({ children }: { children: ReactNode }) {
  const body = (
    <html lang="en" suppressHydrationWarning className={`${inter.variable} ${cairo.variable}`}>
      <head>
        {/* Open the sign-in and database connections while the app's JavaScript downloads. */}
        {EARLY_ORIGINS.map((origin) => (
          <link key={origin} rel="preconnect" href={origin} crossOrigin="anonymous" />
        ))}
      </head>
      <body>
        <Providers>{children}</Providers>
        <WebVitals />
        <OfflineRegistration />
      </body>
    </html>
  );
  return CLOUD ? (
    <ClerkProvider appearance={clerkAppearance} signInUrl="/sign-in" signUpUrl="/sign-up" signInFallbackRedirectUrl="/home" signUpFallbackRedirectUrl="/home">
      {body}
    </ClerkProvider>
  ) : (
    body
  );
}
