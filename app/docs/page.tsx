import Link from "next/link";
import { PublicFrame } from "@/components/marketing/PublicFrame";
import { GROUPS, GUIDES } from "@/lib/docs";

export const metadata = { title: "Guides", description: "How to use Max: pages, organizations, collaboration, publishing, connectors and the API." };

export default function Docs() {
  return (
    <PublicFrame>
      <article className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
        <h1 className="text-3xl font-semibold tracking-tight">Guides</h1>
        <p className="text-fg-2 mt-3 leading-relaxed">How Max works, from your first page to running a whole organization, publishing on the web and building apps that connect to it.</p>
        {GROUPS.map((group) => (
          <section key={group}>
            <h2 className="mt-10 text-lg font-semibold">{group}</h2>
            <ul className="mt-3 grid gap-2">
              {GUIDES.filter((g) => g.group === group).map((g) => (
                <li key={g.slug}>
                  <Link href={`/docs/${g.slug}`} className="hover:bg-hover block rounded-xl px-4 py-3 shadow-[0_0_0_1px_var(--line)]">
                    <span className="block font-medium">{g.title}</span>
                    <span className="text-fg-2 block text-[14px]">{g.summary}</span>
                  </Link>
                </li>
              ))}
              {group === "Publish and connect" && (
                <li>
                  <Link href="/connect" className="hover:bg-hover block rounded-xl px-4 py-3 shadow-[0_0_0_1px_var(--line)]">
                    <span className="block font-medium">Connect an assistant</span>
                    <span className="text-fg-2 block text-[14px]">Use Max from ChatGPT, Claude and other MCP clients.</span>
                  </Link>
                </li>
              )}
            </ul>
          </section>
        ))}
      </article>
    </PublicFrame>
  );
}
