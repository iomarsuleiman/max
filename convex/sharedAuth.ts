import { ConvexError } from "convex/values";
import type { Auth } from "convex/server";
import { MaxError } from "../lib/domain/errors";
import type { ResolvedCollaborationActor } from "../lib/domain/collaboration/collaborationStore";

export async function requireSharedActor(ctx: { auth: Auth }): Promise<ResolvedCollaborationActor> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Sign in to continue." });
  return { userId: identity.subject, verifiedEmail: identity.emailVerified === true && typeof identity.email === "string" ? identity.email.trim().toLowerCase() : null };
}

export async function sharedDisplayName(ctx: { auth: Auth }): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Sign in to continue." });
  const candidate = identity.name || identity.email?.split("@")[0] || "Member";
  const safe = candidate.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 100);
  return safe || "Member";
}

export async function sharedBoundary<T>(run: () => Promise<T>): Promise<T> {
  try { return await run(); } catch (error) {
    if (error instanceof ConvexError) throw error;
    if (error instanceof MaxError) throw new ConvexError({ code: error.code, message: error.message });
    throw new ConvexError({ code: "INTERNAL", message: "Max couldn't finish that request. Try again in a moment." });
  }
}
