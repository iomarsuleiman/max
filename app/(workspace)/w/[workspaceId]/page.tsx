import { notFound } from "next/navigation";
import { CLOUD } from "@/lib/config";
import { WorkspacePreviewPage } from "@/components/workspace/WorkspacePreviewPage";

export const dynamic = "force-dynamic";

/** Routes are not launched or indexed by default. Even when enabled, this page
 * exposes only the current caller's validated membership and NO shared data. */
export default async function WorkspaceLanding({
  params,
}: { params: Promise<{ workspaceId: string }> }) {
  if (!CLOUD ||
      process.env.MAX_V2_NAVIGATION_PREVIEW_ENABLED !== "true" ||
      process.env.NEXT_PUBLIC_MAX_V2_NAVIGATION_PREVIEW_ENABLED !== "true") notFound();
  const { workspaceId } = await params;
  return <WorkspacePreviewPage workspaceId={workspaceId} />;
}
