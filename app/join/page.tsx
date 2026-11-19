import type { Metadata } from "next";
import Link from "next/link";
import { LogoMark } from "@/components/brand/Logo";
import { CLOUD } from "@/lib/config";

export const metadata: Metadata = {
  title: "You're invited to Max",
  description: "A calm, private home for your notes, nested pages and personal databases.",
};

/** Where a membership card's QR code leads: an invitation to join Max. */
export default async function Join({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const { from } = await searchParams;
  const member = from && /^\d{1,9}$/.test(from) ? Number(from) : null;
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-canvas px-4 py-12 text-fg">
      <div className="w-full max-w-[400px] rounded-[20px] bg-[#fffdf0] p-7 text-[#2b2620] shadow-[0_24px_60px_-20px_rgb(0_0_0/.35),0_0_0_1px_rgb(0_0_0/.06)]">
        <div className="flex items-center justify-between font-mono text-[10.5px] font-bold tracking-[.16em]">
          <span>INVITATION</span>
          <LogoMark className="size-6" />
        </div>
        <div className="my-5 h-px bg-[repeating-linear-gradient(90deg,rgb(0_0_0/.25)_0_2px,transparent_2px_5px)]" />
        <p className="card-hand text-[44px] leading-none -rotate-2">You&apos;re invited</p>
        <p className="mt-4 text-[15px] leading-relaxed text-[#2b2620]/80">
          {member ? (
            <>
              Max member <strong className="font-semibold text-[#2b2620]">#{member.toLocaleString("en-US")}</strong> thinks you&apos;d like it here.
            </>
          ) : (
            <>Someone thinks you&apos;d like it here.</>
          )}{" "}
          Max is a calm, private home for your notes, nested pages and personal databases.
        </p>
        <div className="mt-7 grid gap-2">
          <Link href={CLOUD ? "/sign-up" : "/home"} className="flex h-10 items-center justify-center rounded-lg bg-[#2b2620] text-[14px] font-medium text-[#fffdf0] hover:opacity-90">
            Join Max
          </Link>
          {CLOUD && (
            <Link href="/sign-in" className="flex h-10 items-center justify-center rounded-lg text-[14px] text-[#2b2620]/75 hover:bg-black/5">
              I already have an account
            </Link>
          )}
        </div>
      </div>
      <Link href="/welcome" className="mt-6 text-[13px] text-fg-3 underline underline-offset-2">
        What is Max?
      </Link>
    </main>
  );
}
