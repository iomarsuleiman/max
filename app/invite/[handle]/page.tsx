import { permanentRedirect } from "next/navigation";

/** max.chaos.fail/invite/<username> also works: it's the same invitation as max.chaos.fail/<username>. */
export default async function InviteAlias({ params }: { params: Promise<{ handle: string }> }) {
  const handle = decodeURIComponent((await params).handle).toLowerCase().replace(/^@/, "");
  permanentRedirect(/^[a-z0-9._]{3,20}$/.test(handle) ? `/${handle}` : "/join");
}
