import { describe, expect, it } from "vitest";
import { cardInitials, defaultProfileCard, profileCardThemes, profileCardShapes } from "@/lib/domain/profileCard";
import { setup } from "./harness";
import { profileCardSvg } from "@/lib/domain/profileCardImage";

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
    expect(profileCardSvg(defaultProfileCard("Omar")).height).toBeGreaterThan(500);
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

  it("renders all palettes and shapes with artwork-only grain and a dated hatch stamp", () => {
    expect(profileCardThemes.length).toBeGreaterThanOrEqual(10);
    for (const theme of profileCardThemes) for (const shape of profileCardShapes) {
      const { svg } = profileCardSvg({ ...defaultProfileCard("Avery"), theme, shape, createdAt: Date.UTC(2026, 10, 8) });
      expect(svg).toContain("8 Nov 2026");
      expect(svg).toContain("card-art-grain");
      expect(svg).toContain('mask="url(#card-art-mask)"');
      expect(svg).toContain('class="card-qr-modules"');
      expect(svg).not.toContain("card-qr-foil");
      expect(svg).not.toContain("YOUR WORKSPACE CARD");
      expect(svg).not.toContain("<filter");
      expect(svg).not.toMatch(/(?:href|src)="https?:/);
    }
    expect(profileCardSvg(defaultProfileCard("New member")).svg).toContain("NEW CARD");
  });

  it("keeps the metallic QR modules scannable at multiple reflection angles", async () => {
    const { default: sharp } = await import("sharp");
    const { default: jsQR } = await import("jsqr");
    const { PNG } = await import("pngjs");
    const { svg } = profileCardSvg({ ...defaultProfileCard("Avery"), theme: "mint", shape: "band" });
    for (const angle of [0, 90, 180, 270]) {
      const reflected = svg.replace('class="card-foil-gradient"', `class="card-foil-gradient" gradientTransform="rotate(${angle} .5 .5)"`);
      const png = PNG.sync.read(await sharp(Buffer.from(reflected)).resize(1080).extract({ left: 816, top: 1344, width: 192, height: 192 }).png().toBuffer());
      expect(jsQR(new Uint8ClampedArray(png.data), png.width, png.height)?.data).toBe("https://max.chaos.fail");
    }
  }, 15000);
});
