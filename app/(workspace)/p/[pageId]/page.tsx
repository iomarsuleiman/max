import type { Metadata } from "next";
import { PageView } from "@/components/page/PageView";
import { pageIdFromParam } from "@/lib/pageUrl";
import { sharedPreview } from "@/lib/server/invites";

type Props = { params: Promise<{ pageId: string }>; searchParams: Promise<{ share?: string }> };

/** A shared link (…?share=<token>) previews as the page itself: its title, icon and who shared it. */
export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const token = (await searchParams).share;
  if (!token) return {};
  const pageId = pageIdFromParam((await params).pageId);
  const page = await sharedPreview(token, pageId);
  if (!page) return {};
  const title = page.title;
  const description = page.from ? `${page.from} shared ${page.teamspace ? "a teamspace" : "a page"} with you on Max.` : "Shared with you on Max.";
  const images = [{ url: `/api/og?t=${encodeURIComponent(token)}&p=${encodeURIComponent(pageId)}`, width: 1200, height: 630, alt: title }];
  return { title, description, openGraph: { title, description, images, type: "article" }, twitter: { card: "summary_large_image", title, description, images }, robots: { index: false } };
}

export default async function Page({ params }: Props) {
  const pageId = pageIdFromParam((await params).pageId);
  return <PageView key={pageId} pageId={pageId} />;
}
