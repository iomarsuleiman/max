import Link from "next/link";
import { FileQuestion } from "lucide-react";
import { PublicFrame } from "@/components/marketing/PublicFrame";
import { RecoveryPanel, recoveryLinkClass, recoverySecondaryClass } from "@/components/feedback/RecoveryPanel";

export default function NotFound() {
  return (
    <PublicFrame>
      <RecoveryPanel eyebrow="404 · Page not found" title="This page is out of reach." icon={<FileQuestion />} body="It may have been moved to trash, or the address may be incomplete. Open your pages to find it again.">
        <Link href="/home" className={recoveryLinkClass}>Go to my pages</Link>
        <Link href="/trash" className={recoverySecondaryClass}>Check trash</Link>
      </RecoveryPanel>
    </PublicFrame>
  );
}
