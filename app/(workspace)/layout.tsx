import type { ReactNode } from "react";
import { CLOUD } from "@/lib/config";
import { localModeAllowed } from "@/lib/server/local";
import { WorkspaceShell } from "@/components/workspace/Shell";
import { SetupRequired } from "@/components/workspace/SetupRequired";

export const dynamic = "force-dynamic";

export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  if (!CLOUD && !localModeAllowed()) return <SetupRequired />;
  return <WorkspaceShell>{children}</WorkspaceShell>;
}
