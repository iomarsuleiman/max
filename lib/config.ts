/** Deployment mode, decided by which services are configured. */
export const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://max.chaos.fail").replace(/\/$/, "");
export const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";
export const CLERK_KEY = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "";
/** Cloud mode: Clerk accounts + Convex storage. Otherwise Max runs as a private local workspace. */
export const CLOUD = !!(CONVEX_URL && CLERK_KEY);
export const VERSION = "2.0.0";
/** Sharing needs accounts: always on in cloud mode; local mode only in the multi-person test setup. */
export const SHARING_ENABLED = CLOUD || process.env.NEXT_PUBLIC_MAX_LOCAL_MULTIUSER === "true";
export const REPO_URL = "https://github.com/iomarsuleiman/max";
