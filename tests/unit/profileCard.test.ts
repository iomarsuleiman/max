import { describe, expect, it } from "vitest";
import { cardInitials, defaultProfileCard } from "@/lib/domain/profileCard";
import { setup } from "./harness";
import { profileCardSvg } from "@/lib/domain/profileCardImage";

describe("private profile cards", () => {
  it("saves through the shared settings operation and isolates owners", async () => {
    const { as } = setup();
    const alice = as("alice", "mcp");
    const bob = as("bob");
    const card = { ...defaultProfileCard("عمر سليمان"), bio: "Notes in العربية and English", theme: "sage", pattern: "dots" };
    await alice("settings.update", { profileCard: card, profileCardOnboarded: true });
    expect((await alice("settings.get")).settings.profileCard).toEqual(card);
    expect((await bob("settings.get")).settings.profileCard).toBeUndefined();
    await alice("settings.reset", { scope: "all" });
    expect((await alice("settings.get")).settings.profileCard).toEqual(card);
    expect((await alice("settings.get")).settings.profileCardOnboarded).toBe(true);
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
    expect((await call("settings.get")).settings.profileCard).toEqual(card);
  });

  it("supports card tools, safe artwork export and older card preferences", async () => {
    const { as } = setup();
    const call = as("owner", "mcp");
    const card = { ...defaultProfileCard("Omar <script>"), subtitle: "Curious explorer", shape: "orbit" };
    await call("profileCard.update", { card });
    expect((await call("profileCard.get")).card).toEqual(card);
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
