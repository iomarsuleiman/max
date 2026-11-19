import type { Metadata } from "next";
import { SiteView } from "@/components/site/SiteView";

export const metadata: Metadata = { robots: { index: true, follow: true } };

/** A published website: /site/<slug> (its home page) and /site/<slug>/<title-words>-<id>. */
export default async function Site({ params }: { params: Promise<{ slug: string; page?: string[] }> }) {
  const { slug, page } = await params;
  return <SiteView slug={decodeURIComponent(slug).toLowerCase()} pageParam={page?.[0] ?? null} />;
}
