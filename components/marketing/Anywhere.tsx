import Link from "next/link";
import { ArrowRight, Bot, Globe, Smartphone } from "lucide-react";
import { CLOUD } from "@/lib/config";
import { SquiggleLabel } from "./Squiggle";

const rows = [
  { icon: <Globe className="size-7" aria-hidden />, title: "On the web", link: "Open Max", href: CLOUD ? "/sign-up" : "/home", tint: "#ffe6a1" },
  { icon: <Smartphone className="size-7" aria-hidden />, title: "On your phone", link: "Open it, then Add to Home Screen", href: CLOUD ? "/sign-up" : "/home", tint: "#c5f2e5" },
  { icon: <Bot className="size-7" aria-hidden />, title: "With your assistant", link: "Connect Claude or ChatGPT", href: "/connect", tint: "#f6d5eb" },
];

/** "Use Max anywhere": where Max works, in Arc's download-section style. */
export function Anywhere() {
  return (
    <section className="anywhere" aria-labelledby="anywhere-title">
      <SquiggleLabel id="anywhere-title">Use Max anywhere</SquiggleLabel>
      <ul className="mx-auto mt-14 grid max-w-4xl gap-10 px-6">
        {rows.map((r) => (
          <li key={r.title} className="flex flex-wrap items-center gap-6">
            <span className="grid size-16 shrink-0 place-items-center rounded-[20px] text-[#2b2620] shadow-[0_8px_20px_-10px_rgb(0_0_0/.35)]" style={{ background: r.tint }}>
              {r.icon}
            </span>
            <span className="text-[26px] font-semibold tracking-tight text-fg">{r.title}</span>
            <Link href={r.href} className="anywhere-link ms-auto">
              {r.link} <ArrowRight className="size-5" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
      <div className="mt-16">
        <SquiggleLabel>
          <Link href="/privacy" className="hover:text-fg">Private by default. See how →</Link>
        </SquiggleLabel>
      </div>
    </section>
  );
}
