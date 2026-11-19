import { NextResponse } from "next/server";
import { CLOUD } from "@/lib/config";
import { serializeError } from "@/lib/domain/errors";
import { localActor } from "@/lib/server/local";
import { findPersonByEmail } from "@/lib/server/people";

export const dynamic = "force-dynamic";

/** Finds a Max account by exact email for the Share menu. Signed-in callers only. */
export async function GET(request: Request) {
  const email = new URL(request.url).searchParams.get("email") ?? "";
  let callerId: string;
  if (CLOUD) {
    const { auth } = await import("@clerk/nextjs/server");
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "Sign in to share pages." } }, { status: 401 });
    callerId = userId;
  } else {
    callerId = localActor(request).id;
  }
  try {
    return NextResponse.json({ person: await findPersonByEmail(email, callerId) });
  } catch (err) {
    const error = serializeError(err);
    return NextResponse.json({ error }, { status: error.code === "VALIDATION" ? 400 : error.code === "NOT_FOUND" ? 404 : 500 });
  }
}
