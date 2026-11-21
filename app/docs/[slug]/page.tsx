import { notFound } from "next/navigation";
import { PublicFrame } from "@/components/marketing/PublicFrame";
import { GUIDES } from "@/lib/docs";
import { GuideArticle } from "../Guide";

export function generateStaticParams() {
  return GUIDES.map((g) => ({ slug: g.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const guide = GUIDES.find((g) => g.slug === slug);
  return guide ? { title: guide.title, description: guide.summary } : {};
}

export default async function GuidePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const at = GUIDES.findIndex((g) => g.slug === slug);
  if (at < 0) notFound();
  return (
    <PublicFrame>
      <GuideArticle guide={GUIDES[at]} prev={GUIDES[at - 1] ?? null} next={GUIDES[at + 1] ?? null} />
    </PublicFrame>
  );
}
