import Link from "next/link";
import { Fraunces } from "next/font/google";

const heroFont = Fraunces({ subsets: ["latin"], display: "swap", weight: ["600"], variable: "--font-landing-serif" });
import { CLOUD } from "@/lib/config";
import { PlayfulLogo } from "@/components/brand/PlayfulLogo";
import { MadeForYourMind } from "./MadeForYourMind";
import { SiteHeader } from "./SiteHeader";
import { Anywhere } from "./Anywhere";
import { Together } from "./Together";

/** The landing follows the OS palette independently of saved workspace preferences. */
export function LandingContent() {
  return (
    <div className={`${heroFont.variable} landing-system paper-grain bg-canvas text-fg`}>
      <SiteHeader />
      <main>
        <section className="mx-auto flex min-h-[calc(100svh-64px)] max-w-5xl flex-col items-center justify-center px-6 py-20 text-center">
          <PlayfulLogo />
          <h1 className="landing-headline mt-4 max-w-5xl text-[64px] leading-[1.05] font-semibold tracking-[-.035em] sm:text-8xl lg:text-[104px]">
            Think together.
          </h1>
          <Link
            href={CLOUD ? "/sign-up" : "/home"}
            className="landing-action joy-press mt-10 inline-flex min-h-12 items-center justify-center rounded-full px-7 py-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-current"
          >
            Open Max
          </Link>
        </section>
        <MadeForYourMind />
        <Together />
        <Anywhere />
      </main>
    </div>
  );
}
