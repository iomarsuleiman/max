import { PageView } from "@/components/page/PageView";
import { pageIdFromParam } from "@/lib/pageUrl";

export default async function Page({ params }: { params: Promise<{ pageId: string }> }) {
  const pageId = pageIdFromParam((await params).pageId);
  return <PageView key={pageId} pageId={pageId} />;
}
