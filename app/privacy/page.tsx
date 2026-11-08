import { PublicFrame } from "@/components/marketing/PublicFrame";

export const metadata = { title: "Privacy" };

const sections: [string, string[]][] = [
  ["What Max stores", [
    "Your account identity (name, email and sign-in details) is handled by our sign-in provider, Clerk.",
    "Your pages, databases, files and preferences are stored in Max's database (Convex), linked only to your account.",
    "When an assistant is connected, Max logs which operation it ran and whether it succeeded, never the content of your notes.",
  ]],
  ["Who can see your workspace", [
    "Only you. Max has no sharing, public pages or team workspaces. Every read and write is checked against your account on the server.",
    "Connected assistants act with the access you give them, and you can revoke it at any time in Settings → Connections.",
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

export default function Privacy() {
  return (
    <PublicFrame>
      <article className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
        <h1 className="text-3xl font-semibold tracking-tight">How Max handles your data</h1>
        <p className="mt-3 text-fg-2">A plain description of what's stored, who can see it, and how to take it with you or delete it.</p>
        {sections.map(([title, items]) => (
          <section key={title} className="mt-10">
            <h2 className="text-lg font-semibold">{title}</h2>
            <ul className="mt-3 grid list-disc gap-2 ps-5 text-[15px] leading-relaxed text-fg-2">
              {items.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
          </section>
        ))}
      </article>
    </PublicFrame>
  );
}
