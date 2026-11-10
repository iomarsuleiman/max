import { PublicFrame } from "@/components/marketing/PublicFrame";
import { NotionConnectionResult } from "@/components/feedback/NotionConnectionResult";

export const metadata = { title: "Notion connection", robots: { index: false, follow: false } };

export default async function NotionConnectionPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  return <PublicFrame><NotionConnectionResult returned={params.state === "success"} reason={typeof params.reason === "string" ? params.reason : undefined} /></PublicFrame>;
}
