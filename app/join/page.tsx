import type { Metadata } from "next";
import SharedWorkspaceClient from "@/components/shared/SharedWorkspaceClient";
export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" };
export default async function Page({ searchParams }: { searchParams: Promise<{ token?: string }> }) { const { token = "" } = await searchParams; return <SharedWorkspaceClient route={{ kind: "join", token }} />; }
