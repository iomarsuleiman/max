import Link from "next/link";
import { Fraunces } from "next/font/google";

const heroFont = Fraunces({ subsets: ["latin"], display: "swap", weight: ["600"], variable: "--font-landing-serif" });
import { CLOUD } from "@/lib/config";
import { PlayfulLogo } from "@/components/brand/PlayfulLogo";
import { MadeForYourMind } from "./MadeForYourMind";
import { Anywhere } from "./Anywhere";
import { Together } from "./Together";

/** The landing follows the OS palette independently of saved workspace preferences. No navbar here: the hero is the way in. */
export function LandingContent() {
  return (
    <div className={`${heroFont.variable} landing-system paper-grain bg-canvas text-fg`}>
      <main>
        <section className="mx-auto flex min-h-svh max-w-5xl flex-col items-center justify-center px-6 py-20 text-center">
          <PlayfulLogo />
          <h1 className="landing-headline mt-4 max-w-5xl text-[64px] leading-[1.05] font-semibold tracking-[-.035em] sm:text-8xl lg:text-[104px]">
            Think together.
          </h1>
          {/* The main features, in one quiet line. */}
          <p className="landing-features mt-5" aria-label="Note, collaborate and publish">
            <span>Note</span>
            <span aria-hidden>·</span>
            <span>Collaborate</span>
            <span aria-hidden>·</span>
            <span>Publish</span>
          </p>
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
      <footer className="flex min-h-52 items-center justify-center px-6 py-16 text-center">
        <a href="https://wareed.io" className="text-fg-2 hover:text-fg rounded-sm px-3 py-2 font-serif text-sm tracking-[.12em] focus-visible:outline-2 focus-visible:outline-offset-4">
          <span className="italic tracking-normal">By</span>{" "}
          <span className="uppercase">Wareed</span>
        </a>
      </footer>
    </div>
  );
}
