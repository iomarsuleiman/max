import Link from "next/link";
import { Fraunces } from "next/font/google";

const heroFont = Fraunces({ subsets: ["latin"], display: "swap", weight: ["600"], variable: "--font-landing-serif" });
import { CLOUD } from "@/lib/config";
import { PlayfulLogo } from "@/components/brand/PlayfulLogo";
import Walkthrough from "./Walkthrough";

/** The landing follows the OS palette independently of saved workspace preferences. */
export function LandingContent() {
  return (
    <main className={`${heroFont.variable} landing-system paper-grain bg-canvas text-fg`}>
      <section className="mx-auto flex min-h-svh max-w-5xl flex-col items-center justify-center px-6 py-20 text-center">
        <PlayfulLogo />
        <h1 className="landing-headline mt-4 max-w-5xl text-[52px] leading-[1.13] font-semibold tracking-[-.032em] text-balance sm:text-7xl lg:text-[76px]">
          Make room.
        </h1>
        <p className="text-fg-2 mt-7 max-w-xl text-base leading-relaxed text-balance sm:text-xl">
          Your notes, all together.
        </p>
        <Link
          href={CLOUD ? "/sign-up" : "/home"}
          className="landing-action joy-press mt-10 inline-flex min-h-12 items-center justify-center rounded-full px-7 py-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-current"
        >
          Open Max
        </Link>
      </section>
      <Walkthrough />
    </main>
  );
}
