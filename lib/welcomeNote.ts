/**
 * The handwritten note on the back of every membership card.
 *
 * People who found Max on their own get a note from Max's maker. Edit FOUNDER_NAME and FOUNDER_NOTE
 * to write it in your own words ({name} becomes the new member's first name).
 *
 * People who were invited get a note from whoever invited them: that person's own note (Settings →
 * About → "Your note for people you invite"), or INVITE_NOTE signed with their name if they haven't
 * written one.
 */
export const FOUNDER_NAME = "The Max team";
export const FOUNDER_NOTE = "{name},\nthank you for joining.\nI hope Max becomes\na quiet place for\neverything you think\nabout. Welcome in.";
export const INVITE_NOTE = "{name},\nI saved you a seat.\nwelcome to Max.\nI think you'll\nlike it here.";
export const MAX_NOTE_CHARS = 240;

export function writeNote(template: string, memberName: string) {
  const first = Array.from(memberName.trim().split(/\s+/u)[0] ?? "").slice(0, 24).join("") || "Hi";
  return template.replaceAll("{name}", first);
}
