/** Deployment mode, decided by which services are configured. */
export const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://max.chaos.fail").replace(/\/$/, "");
export const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";
export const CLERK_KEY = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "";
/** Cloud mode: Clerk accounts + Convex storage. Otherwise Max runs as a private local workspace. */
export const CLOUD = !!(CONVEX_URL && CLERK_KEY);
export const VERSION = "1.0.0";
export const REPO_URL = "https://github.com/iomarsuleiman/max";
