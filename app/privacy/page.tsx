import { PublicFrame } from "@/components/marketing/PublicFrame";

export const metadata = { title: "Privacy" };

const sections: [string, string[]][] = [
  ["What Max stores", [
    "Your account identity (name, email and sign-in details) is handled by our sign-in provider, Clerk.",
    "Your pages, databases, files and preferences are stored in Max's database (Convex), linked only to your account.",
    "When an assistant is connected, Max logs which operation it ran and whether it succeeded, never the content of your notes.",
  ]],
  ["Who can see your workspace", [
    "Only you, until you share. Every read and write is checked against your account on the server.",
    "When you share a page, the people you invite (and, if you turn it on, anyone signed in to Max with its link) can open that page and the pages inside it, at the level you chose: view, comment, edit or full access. They never see the pages above it or anything else in your workspace.",
    "While a shared page is open, the people on it see each other's names, pictures and cursors, and edits are sent to everyone in the page as they're typed.",
    "If you publish a page to the web, anyone with its link can read that page and the pages inside it without an account. Published pages aren't listed in search engines. Turn publishing off from the Share menu at any time.",
    "Anyone a page is shared with, or who has its published link, can duplicate it into their own workspace. Their copy is theirs; changing your sharing later doesn't remove it.",
    "To invite someone by email, Max checks whether that email belongs to a Max account. A signed-in person can learn that an email has an account this way, as in other tools that share by email.",
    "Connected assistants act with the access you give them, including managing who a page is shared with, and you can revoke them at any time in Settings → Connections.",
  ]],
  ["Your membership card", [
    "Your card shows the name you choose, the date you joined and your member number (your place among everyone who joined Max). It's kept in your account and only leaves it when you download or share it.",
    "The card's QR code opens Max's invitation page and includes only your member number, never your name, email or workspace.",
  ]],
  ["What Max doesn't do", [
    "Max doesn't sell your data, show ads, or use your notes to train AI models.",
    "Error reports and performance measurements never include the text of your pages.",
  ]],
  ["Your controls", [
    "Export everything as Markdown or JSON from Settings → Data.",
    "Trash keeps deleted pages until you empty it; emptying the trash deletes them permanently.",
    "Settings → Account → Delete all data permanently removes every page, file, token and preference in your account.",
  ]],
];

const tints = ["#ffe6a1", "#c5f2e5", "#f6d5eb", "#e3f3bd", "#ccdde7", "#f9d5a1"];

export default function Privacy() {
  return (
    <PublicFrame>
      <article className="mx-auto max-w-3xl px-4 py-14 sm:px-6">
        <p className="font-mono text-[11px] font-bold tracking-[.18em] text-fg-3">PRIVACY</p>
        <h1 className="landing-headline mt-3 text-[40px] leading-[1.08] font-semibold tracking-[-.03em] text-balance sm:text-5xl">How Max handles your data</h1>
        <p className="mt-4 max-w-xl text-[17px] leading-relaxed text-fg-2">A plain description of what&apos;s stored, who can see it, and how to take it with you or delete it.</p>
        <div className="mt-12 grid gap-4">
          {sections.map(([title, items], i) => (
            <section key={title} className="rounded-[24px] bg-surface p-6 shadow-[0_0_0_1px_var(--line),0_14px_30px_-22px_rgb(0_0_0/.3)] sm:p-8" aria-labelledby={`privacy-${i}`}>
              <div className="flex items-center gap-3">
                <span className="grid size-8 shrink-0 place-items-center rounded-full font-mono text-[12px] font-bold text-[#2b2620]" style={{ background: tints[i % tints.length] }} aria-hidden>
                  {String(i + 1).padStart(2, "0")}
                </span>
                <h2 id={`privacy-${i}`} className="text-lg font-semibold tracking-tight">{title}</h2>
              </div>
              <ul className="mt-4 grid gap-3 text-[15px] leading-relaxed text-fg-2">
                {items.map((item) => (
                  <li key={item} className="relative ps-5 before:absolute before:start-0 before:top-[.7em] before:size-1.5 before:rounded-full before:bg-fg-3">
                    {item}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </article>
    </PublicFrame>
  );
}
