import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Inter, Cairo } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { APP_URL, CLOUD } from "@/lib/config";
import { Providers } from "@/components/providers";
import { WebVitals } from "@/components/WebVitals";
import "./globals.css";
import "@/components/editor/editor.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const cairo = Cairo({ subsets: ["arabic"], variable: "--font-arabic", display: "swap" });

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

export default function RootLayout({ children }: { children: ReactNode }) {
  const body = (
    <html lang="en" suppressHydrationWarning className={`${inter.variable} ${cairo.variable}`}>
      <body>
        <Providers>{children}</Providers>
        <WebVitals />
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
