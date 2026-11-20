import Link from "next/link";
import { Fraunces } from "next/font/google";
import { LogoMark } from "@/components/brand/Logo";
import { RememberInviter } from "@/components/share/RememberInviter";
import { CLOUD } from "@/lib/config";
import { defaultProfileCard } from "@/lib/domain/profileCard";
import { profileCardSvg } from "@/lib/domain/profileCardImage";
import type { PublicProfile } from "@/lib/domain/usernames";

const serif = Fraunces({ subsets: ["latin"], display: "swap", weight: ["600"], variable: "--font-landing-serif" });

/**
 * An invitation, in Max's own look: the inviter's membership card, a big serif line, and the
 * same buttons as the landing. Remembers who invited the visitor, for the note on their card.
 */
export function InvitePage({ profile, member }: { profile: PublicProfile | null; member: number | null }) {
  const from = profile?.name ?? null;
  const number = profile?.memberNumber ?? member;
  const card = profileCardSvg(profile?.card ?? { ...defaultProfileCard("You're invited"), subtitle: "Max member" }, "invite").svg;
  return (
    // Fits one screen, phone or desktop: no scrolling.
    <main className={`${serif.variable} landing-system paper-grain flex h-dvh flex-col overflow-hidden bg-canvas text-fg`}>
      {number && <RememberInviter member={number} />}
      <Link href="/welcome" aria-label="Max" className="m-4 inline-flex w-fit shrink-0 items-center gap-2 text-fg sm:m-7">
        <LogoMark className="size-6" />
        <span className="text-[16px] font-semibold tracking-tight">Max</span>
      </Link>
      <div className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col items-center justify-center gap-[clamp(16px,4dvh,40px)] px-6 pb-[max(16px,env(safe-area-inset-bottom))] md:flex-row md:gap-16 md:pb-16">
        <div className="invite-card" aria-hidden dangerouslySetInnerHTML={{ __html: card }} />
        <div className="max-w-md text-center md:text-start">
          <h1 className="landing-headline text-[clamp(32px,5.2dvh,44px)] leading-[1.05] font-semibold tracking-[-.03em] text-balance sm:text-6xl">
            {from ? `${from} invited you.` : "You're invited."}
          </h1>
          <p className="mt-[clamp(10px,2dvh,20px)] text-[clamp(15px,2.1dvh,17px)] leading-relaxed text-fg-2 text-pretty">
            Max is a calm, private home for your notes, pages and databases{from ? `, and ${from.split(" ")[0]} saved you a seat` : ""}. Your card comes with a note from {from ? from.split(" ")[0] : "us"} on the back.
          </p>
          <div className="mt-[clamp(14px,3dvh,32px)] flex flex-col items-center gap-2 sm:flex-row md:items-start">
            <Link href={CLOUD ? "/sign-up" : "/home"} className="landing-action joy-press inline-flex min-h-12 items-center justify-center rounded-full px-7 text-[15px] font-medium">
              Join Max
            </Link>
            {CLOUD && (
              <Link href="/sign-in" className="inline-flex min-h-12 items-center justify-center rounded-full px-5 text-[15px] text-fg-2 hover:bg-hover hover:text-fg">
                I have an account
              </Link>
            )}
          </div>
          {number && <p className="mt-[clamp(12px,3dvh,32px)] font-mono text-[11px] font-bold tracking-[.16em] text-fg-3">INVITED BY MEMBER NO. {String(number).padStart(6, "0")}</p>}
        </div>
      </div>
    </main>
  );
}
