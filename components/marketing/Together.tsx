import { Bot, Copy, Globe, Users } from "lucide-react";

/** Hand-drawn style cursor with a name tag, as people see each other in a shared page. */
function Cursor({ name, color }: { name: string; color: string }) {
  return (
    <span className="relative ms-px inline-block h-5 w-[2px] translate-y-1 rounded-full" style={{ background: color }} aria-hidden>
      <span className="absolute bottom-full left-0 mb-0.5 whitespace-nowrap rounded-md rounded-bl-none px-1.5 py-px text-[10.5px] leading-4 font-semibold text-white" style={{ background: color }}>
        {name}
      </span>
    </span>
  );
}

const tile = "relative overflow-hidden rounded-[28px] p-7 text-[#2b2620] shadow-[0_1px_0_rgb(255_255_255/.6)_inset,0_20px_40px_-24px_rgb(0_0_0/.35)]";

/** "Better together": what sharing in Max feels like, in a bento of colorful tiles. */
export function Together() {
  return (
    <section className="mx-auto max-w-6xl px-5 py-24 sm:px-8" aria-labelledby="together-title">
      <h2 id="together-title" className="landing-headline text-center text-[40px] leading-[1.08] font-semibold tracking-[-.03em] text-balance sm:text-6xl">
        Better together.
      </h2>
      <p className="text-fg-2 mx-auto mt-5 max-w-xl text-center text-base leading-relaxed text-balance sm:text-lg">Share a page and work on it at the same time, like you&apos;re in the same room.</p>
      <div className="mt-14 grid gap-4 md:grid-cols-6">
        <div className={`${tile} min-h-[300px] bg-[linear-gradient(135deg,#ffe6a1,#ffb52d_45%,#ff7e94)] md:col-span-4`}>
          <h3 className="text-2xl font-semibold tracking-tight">Type at the same time.</h3>
          <p className="mt-2 max-w-sm text-[15px] text-[#2b2620]/75">Everyone edits the same page live and sees each other&apos;s cursors. No refresh, no conflicts.</p>
          <div className="relative mt-8 max-w-md rounded-2xl bg-[#fffdf0]/90 p-5 text-[15px] leading-9 shadow-sm">
            <p className="font-semibold">Trip to Lisbon ✈️</p>
            <p className="relative">
              Book the tram tour<Cursor name="Lina" color="#c2255c" />
            </p>
            <p className="relative text-[#2b2620]/70">
              Pastéis de nata at 4<Cursor name="Sam" color="#1971c2" />
            </p>
          </div>
        </div>
        <div className={`${tile} bg-[linear-gradient(160deg,#c5f2e5,#42a9bc)] md:col-span-2`}>
          <Users className="size-7" aria-hidden />
          <h3 className="mt-4 text-xl font-semibold tracking-tight">Share like a note, not a file.</h3>
          <p className="mt-2 text-[15px] text-[#2b2620]/75">Invite by email. Choose who can view, comment, edit or share.</p>
          <div className="mt-5 flex flex-wrap gap-1.5 text-[12px] font-medium">
            {["Full access", "Can edit", "Can comment", "Can view"].map((l) => (
              <span key={l} className="rounded-full bg-white/70 px-2.5 py-1">{l}</span>
            ))}
          </div>
        </div>
        <div className={`${tile} bg-[linear-gradient(160deg,#f6d5eb,#bc9fda)] md:col-span-2`}>
          <Globe className="size-7" aria-hidden />
          <h3 className="mt-4 text-xl font-semibold tracking-tight">Publish in one click.</h3>
          <p className="mt-2 text-[15px] text-[#2b2620]/75">Turn any page into a link anyone can read, no account needed.</p>
        </div>
        <div className={`${tile} bg-[linear-gradient(160deg,#e3f3bd,#3dc6aa)] md:col-span-2`}>
          <Copy className="size-7" aria-hidden />
          <h3 className="mt-4 text-xl font-semibold tracking-tight">Make it your own.</h3>
          <p className="mt-2 text-[15px] text-[#2b2620]/75">Like a page someone shared? Duplicate it into your workspace.</p>
        </div>
        <div className={`${tile} bg-[linear-gradient(160deg,#ccdde7,#8ba6bd)] md:col-span-2`}>
          <Bot className="size-7" aria-hidden />
          <h3 className="mt-4 text-xl font-semibold tracking-tight">Bring your assistant.</h3>
          <p className="mt-2 text-[15px] text-[#2b2620]/75">Claude and ChatGPT can read, write and share pages with your permission.</p>
        </div>
      </div>
    </section>
  );
}
