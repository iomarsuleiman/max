import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { clerkMiddleware } from "@clerk/nextjs/server";

const cloud = !!(process.env.NEXT_PUBLIC_CONVEX_URL && process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
const WORKSPACE = /^\/(home|p|trash|templates)(\/|$)/;
const PREVIEW_ROUTE = /^\/w(?:\/|$)/;

const clerk = clerkMiddleware(async (auth, req) => {
  // Workspace pages need a session. Every data call is also checked by Convex itself.
  if (WORKSPACE.test(req.nextUrl.pathname)) await auth.protect();
});

export default function proxy(req: NextRequest, ev: NextFetchEvent) {
  // Next.js may have already streamed a 200 response before a dynamic
  // page's notFound() is processed. Deny preview routes at the proxy boundary
  // so a default-disabled workspace truly returns HTTP 404.
  if (PREVIEW_ROUTE.test(req.nextUrl.pathname) &&
      (!cloud ||
       process.env.MAX_V2_NAVIGATION_PREVIEW_ENABLED !== "true" ||
       process.env.NEXT_PUBLIC_MAX_V2_NAVIGATION_PREVIEW_ENABLED !== "true")) {
    return new NextResponse(null, { status: 404 });
  }
  if (!cloud) return NextResponse.next();
  return clerk(req, ev);
}

export const config = {
  matcher: ["/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)", "/(api|trpc|mcp)(.*)"],
};
