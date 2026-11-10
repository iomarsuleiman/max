import { z } from "zod";

export const profileCardThemes = ["ocean", "sage", "clay", "lilac", "sunset", "rose", "mint", "amber", "midnight", "lagoon", "plum", "citrus"] as const;
export const profileCardShapes = ["arch", "leaf", "orbit", "band"] as const;

/** Workspace identity; the name is shared with the workspace display name. */
export const profileCardSchema = z.object({
  name: z.string().trim().min(1, "Give your card a name.").max(80),
  subtitle: z.string().trim().max(60).default(""),
  bio: z.string().trim().max(180).default(""),
  theme: z.enum(profileCardThemes),
  pattern: z.enum(["plain", "gradient", "dots"]),
  shape: z.enum(profileCardShapes).default("arch"),
  /** Assigned by the server on the first saved edition. Older cards may not have a recorded date. */
  createdAt: z.number().int().nonnegative().max(8_640_000_000_000_000).optional(),
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
