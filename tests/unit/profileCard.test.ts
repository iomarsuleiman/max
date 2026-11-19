import { describe, expect, it } from "vitest";
import { cardInitials, defaultProfileCard, profileCardThemes, profileCardShapes } from "@/lib/domain/profileCard";
import { setup } from "./harness";
import { profileCardBackSvg, profileCardSvg } from "@/lib/domain/profileCardImage";
import { FOUNDER_NAME, FOUNDER_NOTE, INVITE_NOTE, writeNote } from "@/lib/welcomeNote";

describe("private profile cards", () => {
  it("saves through the shared settings operation and isolates owners", async () => {
    const { as } = setup();
    const alice = as("alice", "mcp");
    const bob = as("bob");
    const card = { ...defaultProfileCard("عمر سليمان"), bio: "Notes in العربية and English", theme: "sage", pattern: "dots" };
    await alice("settings.update", { profileCard: card, profileCardOnboarded: true });
    expect((await alice("settings.get")).settings.profileCard).toMatchObject(card);
    expect((await bob("settings.get")).settings.profileCard).toBeUndefined();
    await alice("settings.reset", { scope: "all" });
    expect((await alice("settings.get")).settings.profileCard).toMatchObject(card);
    expect((await alice("settings.get")).settings.profileCardOnboarded).toBe(true);
  });

  it("uses the Max join date for late-created and legacy cards, including exports and resets", async () => {
    const { as, advance, db } = setup();
    const call = as("member");
    await call("account.init");
    const joined = (await call("settings.get")).settings;
    advance(30 * 86_400_000);
    await call("profileCard.update", { card: { ...defaultProfileCard("Member"), createdAt: 1 } });
    expect((await call("profileCard.get")).card.createdAt).toBe(joined.joinedAt);
    await db.patch("settings", joined._id, { profileCard: defaultProfileCard("Legacy") });
    expect((await call("settings.get")).settings.profileCard.createdAt).toBe(joined.joinedAt);
    expect((await call("profileCard.export")).svg).toContain("8 Nov 2026");
    await call("settings.reset", { scope: "all" });
    expect((await call("settings.get")).settings.joinedAt).toBe(joined.joinedAt);
    await call("profileCard.update", { card: defaultProfileCard("Updated") });
    expect((await call("profileCard.get")).card.createdAt).toBe(joined.joinedAt);
  });

  it("validates card fields at the persistence boundary without losing existing data", async () => {
    const call = setup().as("owner");
    const card = defaultProfileCard("Omar");
    await call("settings.update", { profileCard: card });
    for (const invalid of [
      { ...card, name: " " },
      { ...card, bio: "x".repeat(181) },
      { ...card, theme: "unknown" },
      { ...card, pattern: "remote-url" },
      { ...card, subtitle: "x".repeat(61) },
      { ...card, shape: "unknown" },
    ]) {
      await expect(call("settings.update", { profileCard: invalid })).rejects.toMatchObject({ code: "VALIDATION" });
    }
    expect((await call("settings.get")).settings.profileCard).toMatchObject(card);
  });

  it("supports card tools, safe artwork export and older card preferences", async () => {
    const { as } = setup();
    const call = as("owner", "mcp");
    const card = { ...defaultProfileCard("Omar <script>"), subtitle: "Curious explorer", shape: "orbit" };
    await call("profileCard.update", { card });
    expect((await call("profileCard.get")).card).toMatchObject(card);
    expect((await as("other", "mcp")("profileCard.get")).card).toBeNull();
    const exported = await call("profileCard.export");
    expect(exported.svg).toContain("&lt;script&gt;");
    expect(exported.svg).not.toContain("<script>");
    expect(exported.mimeType).toBe("image/svg+xml");
    const old = { name: "Older card", bio: "", theme: "ocean", pattern: "plain" };
    await call("settings.update", { profileCard: old });
    expect((await call("profileCard.get")).card).toMatchObject({ subtitle: "", shape: "arch" });
    expect(profileCardSvg(defaultProfileCard("Omar"))).toMatchObject({ width: 300, height: 380 });
  });

  it("persists skipped onboarding independently of card creation", async () => {
    const call = setup().as("owner");
    await call("account.init");
    await call("settings.update", { profileCardOnboarded: true });
    await call("account.init");
    const { settings } = await call("settings.get");
    expect(settings.profileCardOnboarded).toBe(true);
    expect(settings.profileCard).toBeUndefined();
  });

  it("creates readable initials for multilingual names and Unicode characters", () => {
    expect(cardInitials(" عمر سليمان ")).toBe("عس");
    expect(cardInitials("Omar Suliman")).toBe("OS");
    expect(cardInitials("🪴 Gardener")).toBe("🪴G");
    expect(cardInitials("")).toBe("M");
  });
});


describe("one workspace/card identity", () => {
  it("synchronizes UI and MCP names atomically and preserves the server-issued date", async () => {
    const { as, advance } = setup();
    const call = as("member", "mcp");
    await call("profileCard.update", { card: { ...defaultProfileCard("Avery"), createdAt: 1 } });
    const initial = (await call("profileCard.get")).card;
    expect(initial.createdAt).toBeGreaterThan(Date.UTC(2026, 10, 8));
    expect((await call("settings.get")).settings.displayName).toBe("Avery");
    advance(10 * 86_400_000);
    await call("settings.update", { displayName: "Avery Maker" });
    expect((await call("profileCard.get")).card).toMatchObject({ name: "Avery Maker", createdAt: initial.createdAt });
    await call("profileCard.update", { card: { ...initial, name: "Avery M.", createdAt: 999 } });
    const settings = (await call("settings.get")).settings;
    expect(settings.displayName).toBe("Avery M.");
    expect(settings.profileCard).toMatchObject({ name: "Avery M.", createdAt: initial.createdAt });
    await expect(call("settings.update", { displayName: "Different", profileCard: initial })).rejects.toMatchObject({ code: "VALIDATION" });
    expect((await call("settings.get")).settings.displayName).toBe("Avery M.");
  });

  it("reconciles older divergent names on read without losing legacy biography", async () => {
    const { as, db } = setup();
    const call = as("member");
    await call("settings.update", { profileCard: { ...defaultProfileCard("Old card name"), bio: "A private older biography" } });
    const current = (await call("settings.get")).settings;
    await db.patch("settings", current._id, { displayName: "Preferred workspace name" });
    expect((await call("profileCard.get")).card).toMatchObject({ name: "Preferred workspace name", bio: "A private older biography" });
    expect((await call("settings.get")).settings.profileCard.name).toBe("Preferred workspace name");
    const exported = await call("profileCard.export");
    expect(exported.svg).not.toContain("A private older biography");
  });

  it("renders the account card with a fractional Convex join timestamp", () => {
    const joinedAt = Date.UTC(2026, 10, 8) + 0.125;
    expect(profileCardSvg({ ...defaultProfileCard("Member"), createdAt: joinedAt }).svg).toContain("8 Nov 2026");
  });

  it("renders all palettes and artworks with lighting, a dated stamp and no QR on the front", () => {
    expect(profileCardThemes.length).toBeGreaterThanOrEqual(10);
    for (const theme of profileCardThemes) for (const shape of profileCardShapes) {
      const { svg } = profileCardSvg({ ...defaultProfileCard("Avery"), theme, shape, createdAt: Date.UTC(2026, 10, 8) });
      expect(svg).toContain("8 Nov 2026");
      expect(svg).toContain("card-art-light");
      // Plain gradients only: no filters, so tilting and flipping stay smooth.
      expect(svg).not.toContain("<filter");
      expect(svg).not.toContain("card-qr");
      expect(svg).not.toContain("data:image");
      expect(svg).not.toMatch(/(?:href|src)="https?:/);
      expect(svg).toContain("MAX MEMBER");
    }
    expect(profileCardSvg(defaultProfileCard("New member")).svg).toContain("NEW CARD");
  });

  it("writes a note on the back: from Max's maker, or from whoever invited you", () => {
    const card = { ...defaultProfileCard("Avery Lane"), memberNumber: 42, createdAt: Date.UTC(2026, 10, 8) };
    const founder = profileCardBackSvg(card, { text: writeNote(FOUNDER_NOTE, "Avery Lane"), from: FOUNDER_NAME });
    expect(founder).toContain("Avery,");
    expect(founder).toContain(FOUNDER_NAME);
    expect(founder).toContain("Nov 8, 2026");
    expect(founder).not.toContain("<filter");
    const invited = profileCardBackSvg(card, { text: "Avery,\nso glad you came.", from: "Sam" });
    expect(invited).toContain("so glad you came.");
    expect(invited).toContain(">Sam<");
    // Handwriting is escaped like everything else.
    expect(profileCardBackSvg(card, { text: "<b>hi</b>", from: "<i>x</i>" })).not.toMatch(/<b>|<i>/);
  });

  it("gives the note from the inviter when you joined through their link", async () => {
    const h = setup();
    const sam = h.as("user_sam");
    await sam("settings.update", { displayName: "Sam" });
    await sam("settings.update", { inviteNote: "{name},\nso glad you came." });
    const avery = h.as("user_avery");
    await avery("account.init", { displayName: "Avery Lane", invitedBy: 1 });
    await avery("profileCard.update", { card: { ...defaultProfileCard("Avery Lane") } });
    const got = await avery<{ note: { from: string; text: string; invited: boolean }; memberNumber: number }>("profileCard.get", {});
    expect(got.memberNumber).toBe(2);
    expect(got.note).toEqual({ from: "Sam", text: "Avery,\nso glad you came.", invited: true });
    // Without a note of their own, the inviter signs Max's invite note.
    await sam("settings.update", { inviteNote: null });
    expect((await avery<{ note: { from: string; text: string } }>("profileCard.get", {})).note).toMatchObject({ from: "Sam", text: writeNote(INVITE_NOTE, "Avery Lane") });
    // Someone who found Max alone gets the maker's note.
    expect((await sam<{ note: { from: string; invited: boolean } }>("profileCard.get", {})).note).toMatchObject({ from: FOUNDER_NAME, invited: false });
  });
});
