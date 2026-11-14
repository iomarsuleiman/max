import SharedWorkspaceClient from "@/components/shared/SharedWorkspaceClient";
export default async function Page({ params }: { params: Promise<{ workspaceId: string; pageId: string }> }) { const { workspaceId, pageId } = await params; return <SharedWorkspaceClient route={{ kind: "workspace", workspaceId, pageId }} />; }
