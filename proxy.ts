import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { clerkMiddleware } from "@clerk/nextjs/server";

const cloud = !!(process.env.NEXT_PUBLIC_CONVEX_URL && process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
const WORKSPACE = /^\/(home|p|trash|templates)(\/|$)/;

const clerk = clerkMiddleware(async (auth, req) => {
  // Workspace pages need a session. Every data call is also checked by Convex itself.
  if (WORKSPACE.test(req.nextUrl.pathname)) await auth.protect();
});

export default function proxy(req: NextRequest, ev: NextFetchEvent) {
  if (!cloud) return NextResponse.next();
  return clerk(req, ev);
}

export const config = {
  matcher: ["/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)", "/(api|trpc|mcp)(.*)"],
};
