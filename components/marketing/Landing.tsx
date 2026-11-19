import Link from "next/link";
import { Fraunces } from "next/font/google";

const heroFont = Fraunces({ subsets: ["latin"], display: "swap", weight: ["600"], variable: "--font-landing-serif" });
import { CLOUD } from "@/lib/config";
import { PlayfulLogo } from "@/components/brand/PlayfulLogo";
import Walkthrough from "./Walkthrough";
import { CardShowcase } from "./CardShowcase";
import { Together } from "./Together";

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
      <Together />
      <section className="mx-auto grid max-w-6xl items-center gap-12 px-5 pt-8 pb-28 sm:px-8 md:grid-cols-2" aria-labelledby="card-title">
        <div className="md:order-2">
          <p className="font-mono text-[11px] font-bold tracking-[.18em] text-fg-3">EVERY MEMBER GETS A CARD</p>
          <h2 id="card-title" className="landing-headline mt-4 text-[40px] leading-[1.08] font-semibold tracking-[-.03em] text-balance sm:text-6xl">
            A little card.
            <br />
            All you.
          </h2>
          <p className="text-fg-2 mt-5 max-w-md text-base leading-relaxed sm:text-lg">
            Pick its artwork and put your name on it. Flip it over for your member number, written by hand, and a QR code that invites your friends to Max.
          </p>
          <Link
            href={CLOUD ? "/sign-up" : "/home"}
            className="landing-action joy-press mt-8 inline-flex min-h-12 items-center justify-center rounded-full px-7 py-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-current"
          >
            Get your card
          </Link>
        </div>
        <CardShowcase />
      </section>
    </main>
  );
}
