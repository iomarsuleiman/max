import { NextResponse, type NextRequest } from "next/server";
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const cloud = !!(process.env.NEXT_PUBLIC_CONVEX_URL && process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
const isWorkspace = createRouteMatcher(["/home(.*)", "/p/(.*)", "/trash(.*)", "/templates(.*)", "/import(.*)"]);

const clerk = clerkMiddleware(async (auth, req) => {
  if (isWorkspace(req)) await auth.protect();
});

/** Cloud mode: workspace routes require a Clerk session (Convex also checks identity on every call). */
export default function proxy(req: NextRequest, ev: Parameters<typeof clerk>[1]) {
  if (!cloud) return NextResponse.next();
  return clerk(req, ev);
}

export const config = {
  matcher: ["/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)", "/(api|trpc|mcp)(.*)"],
};
