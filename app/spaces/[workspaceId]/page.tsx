import SharedWorkspaceClient from "@/components/shared/SharedWorkspaceClient";
export default async function Page({ params }: { params: Promise<{ workspaceId: string }> }) { const { workspaceId } = await params; return <SharedWorkspaceClient route={{ kind: "workspace", workspaceId }} />; }
