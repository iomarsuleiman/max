import type { Metadata } from "next";
import { PublicPage } from "@/components/share/PublicPage";
import { pageIdFromParam } from "@/lib/pageUrl";

// Published pages aren't listed in search engines unless the owner shares the link.
export const metadata: Metadata = { title: "Published with Max", robots: { index: false, follow: false } };

export default async function PublishedPage({ params }: { params: Promise<{ token: string; page: string }> }) {
  const { token, page } = await params;
  return <PublicPage token={/^[a-f0-9]{16,64}$/.test(token) ? token : "invalid"} pageId={pageIdFromParam(page)} />;
}
