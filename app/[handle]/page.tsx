import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { InvitePage } from "@/components/marketing/InvitePage";
import { publicProfile } from "@/lib/server/invites";
import { USERNAME } from "@/lib/domain/usernames";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ handle: string }> };

async function load(handle: string) {
  const name = decodeURIComponent(handle).toLowerCase().replace(/^@/, "");
  return USERNAME.test(name) ? publicProfile(name) : null;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const profile = await load((await params).handle);
  if (!profile) return { title: "Not found" };
  const title = `${profile.name} invited you to Max`;
  const description = "A calm, private home for your notes, pages and databases. Join with a card and a note waiting for you.";
  const images = [{ url: `/api/og?u=${encodeURIComponent(profile.username)}`, width: 1200, height: 630, alt: title }];
  return { title, description, openGraph: { title, description, type: "website", images }, twitter: { card: "summary_large_image", title, description, images }, robots: { index: false } };
}

/** max.chaos.fail/<username>: that person's invitation to Max. */
export default async function Invite({ params }: Params) {
  const profile = await load((await params).handle);
  if (!profile) notFound();
  return <InvitePage profile={profile} member={null} />;
}
