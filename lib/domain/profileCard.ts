import { z } from "zod";

/** Private workspace identity, independent of the sign-in account. */
export const profileCardSchema = z.object({
  name: z.string().trim().min(1, "Give your card a name.").max(80),
  subtitle: z.string().trim().max(60).default(""),
  bio: z.string().trim().max(180),
  theme: z.enum(["ocean", "sage", "clay", "lilac", "sunset"]),
  pattern: z.enum(["plain", "gradient", "dots"]),
  shape: z.enum(["arch", "leaf", "orbit"]).default("arch"),
});

export type ProfileCard = z.infer<typeof profileCardSchema>;

export function defaultProfileCard(name: string): ProfileCard {
  return { name: name.trim().slice(0, 80) || "You", subtitle: "Curious explorer", bio: "", theme: "sunset", pattern: "gradient", shape: "arch" };
}

export function cardInitials(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/u)
      .slice(0, 2)
      .map((part) => Array.from(part)[0] ?? "")
      .join("")
      .toLocaleUpperCase() || "M"
  );
}
