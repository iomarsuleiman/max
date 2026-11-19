import type { Metadata } from "next";
import { InvitePage } from "@/components/marketing/InvitePage";

export const metadata: Metadata = {
  title: "You're invited to Max",
  description: "A calm, private home for your notes, nested pages and personal databases.",
};

/** Older invite links (by member number) still work; new ones are max.chaos.fail/<username>. */
export default async function Join({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const { from } = await searchParams;
  const member = from && /^\d{1,9}$/.test(from) ? Number(from) : null;
  return <InvitePage profile={null} member={member} />;
}
