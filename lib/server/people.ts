import "server-only";
import { CLOUD } from "@/lib/config";
import { MaxError } from "@/lib/domain/errors";
import { localModeAllowed } from "./local";

export interface Person {
  id: string;
  email: string;
  name: string;
  image: string | null;
}

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;

/**
 * Finds a Max account by exact email (never partial matches or lists), for sharing. Cloud mode asks
 * Clerk; local multi-person test mode treats the part before @ as the pretend account.
 */
export async function findPersonByEmail(rawEmail: string, callerId: string): Promise<Person> {
  const email = rawEmail.trim().toLowerCase();
  if (!EMAIL.test(email)) throw new MaxError("VALIDATION", "Enter a full email address.");
  if (!CLOUD) {
    if (!localModeAllowed() || process.env.MAX_LOCAL_MULTIUSER !== "true") throw new MaxError("NOT_FOUND", "Sharing needs Max's cloud accounts. Local mode has one person.");
    const id = email.split("@")[0].replace(/[^a-z0-9_]/g, "").slice(0, 40);
    if (!id || id === callerId) throw new MaxError("VALIDATION", "That's you.");
    return { id, email, name: id.charAt(0).toUpperCase() + id.slice(1), image: null };
  }
  const { clerkClient } = await import("@clerk/nextjs/server");
  const client = await clerkClient();
  const { data } = await client.users.getUserList({ emailAddress: [email], limit: 1 });
  const user = data[0];
  if (!user) throw new MaxError("NOT_FOUND", `No one with ${email} has a Max account yet. Ask them to sign up at max.chaos.fail, then share again.`);
  if (user.id === callerId) throw new MaxError("VALIDATION", "That's you.");
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ") || user.username || email.split("@")[0];
  return { id: user.id, email, name, image: user.imageUrl ?? null };
}
