import Link from "next/link";
import { Link2 } from "lucide-react";
import { PublicFrame } from "@/components/marketing/PublicFrame";
import { RecoveryPanel, recoveryLinkClass, recoverySecondaryClass } from "@/components/feedback/RecoveryPanel";
import { connectionMessage } from "@/components/feedback/connectionState";

export const metadata = { title: "Connection help", robots: { index: false, follow: false } };

/** A help destination, not an OAuth callback or an assertion of authentication. */
export default async function ConnectionStatusPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const reason = typeof params.reason === "string" ? params.reason : undefined;
  const message = reason === "invalid_target" ? connectionMessage(reason) : {
    title: "Return to your assistant.",
    body: "Your assistant owns its sign-in callback window. Check its connection status there. Max cannot confirm an assistant connection from this page.",
    action: "Open connection help",
  };
  return (
    <PublicFrame>
      <RecoveryPanel eyebrow="Assistant connection" title={message.title} body={message.body} icon={<Link2 />} footnote="You can review and revoke assistant access in Settings, Connections.">
        <Link href="/connect" className={recoveryLinkClass}>{message.action}</Link>
        <Link href="/home?settings=connections" className={recoverySecondaryClass}>Open Connections</Link>
      </RecoveryPanel>
    </PublicFrame>
  );
}
