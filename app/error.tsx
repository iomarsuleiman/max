"use client";

import { RuntimeRecovery } from "@/components/feedback/RuntimeRecovery";

export default function ErrorPage({ retry }: { error: unknown; retry: () => void }) {
  return <RuntimeRecovery retry={retry} />;
}
