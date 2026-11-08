import { LogoMark } from "@/components/brand/Logo";

/** Shown on a production deployment that hasn't been connected to Clerk and Convex yet. */
export function SetupRequired() {
  return (
    <main className="grid min-h-dvh place-items-center bg-canvas px-4">
      <div className="max-w-md">
        <LogoMark className="mb-6 size-9 text-fg" />
        <h1 className="text-xl font-semibold">Max needs to be connected</h1>
        <p className="mt-2 text-[14px] leading-relaxed text-fg-2">
          This deployment doesn&apos;t have its sign-in and database services configured yet, so no workspace can open. Set these environment variables and redeploy:
        </p>
        <ul className="mt-4 grid gap-1 font-mono text-[12.5px] text-fg-2" dir="ltr">
          <li>NEXT_PUBLIC_CONVEX_URL</li>
          <li>NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY</li>
          <li>CLERK_SECRET_KEY</li>
          <li>MAX_SERVER_SECRET</li>
        </ul>
        <p className="mt-4 text-[13px] text-fg-3">See docs/SETUP.md in the repository for the full checklist.</p>
      </div>
    </main>
  );
}
