import { APP_URL } from "@/lib/config";
import { PublicFrame } from "@/components/marketing/PublicFrame";

export const metadata = { title: "Connect an assistant" };

export default function Connect() {
  const url = `${APP_URL}/mcp`;
  return (
    <PublicFrame>
      <article className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
        <h1 className="text-3xl font-semibold tracking-tight">Connect an assistant to Max</h1>
        <p className="mt-3 leading-relaxed text-fg-2">
          Max speaks the Model Context Protocol (MCP). Connected assistants such as ChatGPT and Claude can read, search, write and organize your pages and databases: everything you can do in Max itself. Access is
          limited to your account and you can revoke it at any time.
        </p>
        <h2 className="mt-10 text-lg font-semibold">Server address</h2>
        <pre className="mt-3 overflow-x-auto rounded-lg bg-surface-2 px-4 py-3 font-mono text-[13px]" dir="ltr">{url}</pre>
        <h2 className="mt-10 text-lg font-semibold">ChatGPT and Claude</h2>
        <ol className="mt-3 grid list-decimal gap-2 ps-5 text-[15px] leading-relaxed text-fg-2">
          <li>Open your assistant's connector settings and add a custom MCP connector.</li>
          <li>Paste the server address above. When asked to sign in, use your Max account.</li>
          <li>Ask something like “Summarize my Video Projects board” or “Add a page with today's meeting notes”.</li>
        </ol>
        <h2 className="mt-10 text-lg font-semibold">Other MCP clients</h2>
        <p className="mt-3 leading-relaxed text-fg-2">
          Create an access token in <strong>Settings → Connections</strong> and send it as <code className="rounded bg-surface-2 px-1 font-mono text-[13px]">Authorization: Bearer max_…</code>. Tokens are shown once and
          can be revoked individually.
        </p>
        <h2 className="mt-10 text-lg font-semibold">Safety</h2>
        <ul className="mt-3 grid list-disc gap-2 ps-5 text-[15px] leading-relaxed text-fg-2">
          <li>Permanent deletions require explicit confirmation; moving to trash can be undone.</li>
          <li>Writes check the page's revision, so an assistant never silently overwrites edits you made meanwhile.</li>
          <li>Access tokens and account deletion can only be managed inside Max, never by an assistant.</li>
          <li>Settings → Connections lists recent assistant activity (operation names only, never content).</li>
        </ul>
      </article>
    </PublicFrame>
  );
}
