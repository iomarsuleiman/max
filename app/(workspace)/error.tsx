"use client";

import { RuntimeRecovery } from "@/components/feedback/RuntimeRecovery";

export default function WorkspaceError({ retry }: { error: unknown; retry: () => void }) {
  return <RuntimeRecovery retry={retry} workspace />;
}
