import type { Metadata } from "next";
import { PublicPage } from "@/components/share/PublicPage";
import { pageIdFromParam } from "@/lib/pageUrl";
import { sharedPreview } from "@/lib/server/invites";

type Props = { params: Promise<{ token: string; page: string }> };

const validToken = (token: string) => (/^[a-f0-9]{16,64}$/.test(token) ? token : "invalid");

// Published pages aren't listed in search engines; links to them preview as the page itself.
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { token, page } = await params;
  const pageId = pageIdFromParam(page);
  const preview = await sharedPreview(validToken(token), pageId);
  const robots = { index: false, follow: false };
  if (!preview) return { title: "Published with Max", robots };
  const description = preview.from ? `Published by ${preview.from} on Max.` : "Published on Max.";
  const images = [{ url: `/api/og?t=${encodeURIComponent(token)}&p=${encodeURIComponent(pageId)}`, width: 1200, height: 630, alt: preview.title }];
  return { title: preview.title, description, robots, openGraph: { title: preview.title, description, images, type: "article" }, twitter: { card: "summary_large_image", title: preview.title, description, images } };
}

export default async function PublishedPage({ params }: Props) {
  const { token, page } = await params;
  return <PublicPage token={validToken(token)} pageId={pageIdFromParam(page)} />;
}
