import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SiteView } from "@/components/site/SiteView";
import { AppRoot } from "@/components/AppRoot";
import { siteHandle } from "@/lib/server/invites";

export const metadata: Metadata = { robots: { index: true, follow: true } };
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ handle: string; site: string; page?: string[] }> };

/** A published website under its owner's username: max.chaos.fail/<username>/<site>/<page>. */
export default async function UserSite({ params }: Props) {
  const { handle, site, page } = await params;
  const slug = decodeURIComponent(site).toLowerCase();
  // Only the owner's username leads to their site.
  if ((await siteHandle(slug)) !== decodeURIComponent(handle).toLowerCase()) notFound();
  return (
    <AppRoot>
      <SiteView slug={slug} pageParam={page?.[0] ?? null} />
    </AppRoot>
  );
}
