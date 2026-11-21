import Link from "next/link";
import type { Block, Guide } from "@/lib/docs";
import { APP_URL } from "@/lib/config";

/** One block of a guide, in the same type as /connect. */
function Body({ block }: { block: Block }) {
  if ("p" in block) return <p className="text-fg-2 mt-3 leading-relaxed">{block.p}</p>;
  if ("steps" in block)
    return (
      <ol className="text-fg-2 mt-3 grid list-decimal gap-2 ps-5 text-[15px] leading-relaxed">
        {block.steps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
    );
  if ("list" in block)
    return (
      <ul className="text-fg-2 mt-3 grid list-disc gap-2 ps-5 text-[15px] leading-relaxed">
        {block.list.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ul>
    );
  return (
    <pre dir="ltr" className="bg-surface-2 mt-3 overflow-x-auto rounded-lg p-3 font-mono text-[12.5px] leading-relaxed shadow-[inset_0_0_0_1px_var(--line)]">
      {block.code.replaceAll("https://max.chaos.fail", APP_URL)}
    </pre>
  );
}

export function GuideArticle({ guide, prev, next }: { guide: Guide; prev: Guide | null; next: Guide | null }) {
  return (
    <article className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
      <p className="text-fg-3 text-sm">
        <Link href="/docs" className="underline-offset-4 hover:underline">Guides</Link> · {guide.group}
      </p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">{guide.title}</h1>
      <p className="text-fg-2 mt-3 leading-relaxed">{guide.summary}</p>
      {guide.sections.map((s) => (
        <section key={s.h}>
          <h2 className="mt-10 text-lg font-semibold">{s.h}</h2>
          {s.body.map((b, i) => (
            <Body key={i} block={b} />
          ))}
        </section>
      ))}
      <nav aria-label="More guides" className="border-line mt-14 flex justify-between gap-4 border-t pt-6 text-[14px]">
        {prev ? <Link href={`/docs/${prev.slug}`} className="underline-offset-4 hover:underline">← {prev.title}</Link> : <span />}
        {next ? <Link href={`/docs/${next.slug}`} className="text-end underline-offset-4 hover:underline">{next.title} →</Link> : <span />}
      </nav>
    </article>
  );
}
