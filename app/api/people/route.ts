import { NextResponse } from "next/server";
import { CLOUD } from "@/lib/config";
import { localActor, localModeAllowed } from "@/lib/server/local";

export const dynamic = "force-dynamic";

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;

/**
 * Finds a Max account by exact email, for the Share menu. Signed-in callers only; returns just
 * the account id, display name and picture, never a list or partial matches.
 */
export async function GET(request: Request) {
  const email = new URL(request.url).searchParams.get("email")?.trim().toLowerCase() ?? "";
  if (!EMAIL.test(email)) return NextResponse.json({ error: { code: "VALIDATION", message: "Enter a full email address." } }, { status: 400 });

  if (!CLOUD) {
    if (!localModeAllowed() || process.env.MAX_LOCAL_MULTIUSER !== "true") {
      return NextResponse.json({ error: { code: "NOT_FOUND", message: "Sharing needs Max's cloud accounts. Local mode has one person." } }, { status: 404 });
    }
    // Test/demo mode: the part before @ is the pretend account (see localActor).
    const id = email.split("@")[0].replace(/[^a-z0-9_]/g, "").slice(0, 40);
    if (!id || id === localActor(request).id) return NextResponse.json({ error: { code: "VALIDATION", message: "That's you." } }, { status: 400 });
    return NextResponse.json({ person: { id, email, name: id.charAt(0).toUpperCase() + id.slice(1), image: null } });
  }

  const { auth, clerkClient } = await import("@clerk/nextjs/server");
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "Sign in to share pages." } }, { status: 401 });
  const client = await clerkClient();
  const { data } = await client.users.getUserList({ emailAddress: [email], limit: 1 });
  const user = data[0];
  if (!user) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: `No one with ${email} has a Max account yet. Ask them to sign up at max.chaos.fail, then share again.` } },
      { status: 404 },
    );
  }
  if (user.id === userId) return NextResponse.json({ error: { code: "VALIDATION", message: "That's you." } }, { status: 400 });
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ") || user.username || email.split("@")[0];
  return NextResponse.json({ person: { id: user.id, email, name, image: user.imageUrl ?? null } });
}
