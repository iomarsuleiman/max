import { PageView } from "@/components/page/PageView";

export default async function Page({ params }: { params: Promise<{ pageId: string }> }) {
  const { pageId } = await params;
  return <PageView key={pageId} pageId={pageId} />;
}
