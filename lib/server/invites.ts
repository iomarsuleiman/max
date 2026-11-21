import "server-only";
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import { CLOUD, CONVEX_URL } from "@/lib/config";
import type { PublicProfile } from "@/lib/domain/usernames";
import { localModeAllowed, localDb } from "./local";

type Preview = { title: string; icon: string | null; from: string | null; public: boolean; teamspace: boolean };

/** A person's public invite profile by username, for /<username> and its preview image. */
export async function publicProfile(username: string): Promise<PublicProfile | null> {
  try {
    if (CLOUD) return (await new ConvexHttpClient(CONVEX_URL).query(anyApi.invites.profile, { username })) as PublicProfile | null;
    if (!localModeAllowed()) return null;
    return (await import("@/lib/domain/usernames")).profileByUsername(await localDb(), username);
  } catch {
    return null;
  }
}

/** A shared link's title, icon and sender, for link previews. */
export async function sharedPreview(token: string, pageId: string): Promise<Preview | null> {
  try {
    if (CLOUD) return (await new ConvexHttpClient(CONVEX_URL).query(anyApi.invites.preview, { token, pageId })) as Preview | null;
    if (!localModeAllowed()) return null;
    return (await import("@/lib/domain/sharing")).linkPreview(await localDb(), token, pageId);
  } catch {
    return null;
  }
}

/** Which username a published site lives under, for /<username>/<site>. */
export async function siteHandle(slug: string): Promise<string | null> {
  try {
    if (CLOUD) return (await new ConvexHttpClient(CONVEX_URL).query(anyApi.invites.siteHandle, { slug })) as string | null;
    if (!localModeAllowed()) return null;
    return (await import("@/lib/domain/usernames")).siteHandle(await localDb(), slug);
  } catch {
    return null;
  }
}

/** Whether a top-level address (max.chaos.fail/<slug>) is a site published by Max's admins. */
export async function isRootSite(slug: string): Promise<boolean> {
  try {
    if (CLOUD) return (await new ConvexHttpClient(CONVEX_URL).query(anyApi.invites.rootSite, { slug })) as boolean;
    if (!localModeAllowed()) return false;
    return (await import("@/lib/domain/usernames")).isRootSite(await localDb(), slug);
  } catch {
    return false;
  }
}
