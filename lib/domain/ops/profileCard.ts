import { z } from "zod";
import { defineOp } from "./define";
import { getSettingsRow } from "./helpers";
import { settingsUpdate } from "./account";
import { profileCardSchema } from "../profileCard";
import { profileCardSvg } from "../profileCardImage";
import { MaxError } from "../errors";

export const profileCardGet = defineOp({
  name: "profileCard.get",
  kind: "query",
  title: "Read my workspace card",
  description:
    "Returns your private customizable Max card, including name, subtitle, biography, palette, artwork and pattern. Other accounts' cards are inaccessible.",
  input: z.object({}),
  async run(ctx) {
    const settings = await getSettingsRow(ctx);
    const saved = profileCardSchema.safeParse(settings?.profileCard);
    return { card: saved.success ? { ...saved.data, createdAt: settings?.joinedAt ?? saved.data.createdAt, name: settings?.displayName?.trim() || saved.data.name } : null };
  },
});
export const profileCardUpdate = defineOp({
  name: "profileCard.update",
  kind: "mutation",
  title: "Customize my workspace card",
  description:
    "Saves your private workspace card with the same validation as Max's card editor. This does not change your sign-in identity or publish a public profile.",
  input: z.object({ card: profileCardSchema }),
  async run(ctx, { card }) {
    const { settings } = await settingsUpdate.run(ctx, { profileCard: card, profileCardOnboarded: true });
    return { card: profileCardSchema.parse(settings.profileCard) };
  },
});
export const profileCardExport = defineOp({
  name: "profileCard.export",
  kind: "query",
  title: "Export my workspace card",
  description:
    "Returns a self-contained SVG of your saved card using Max's native card renderer. No private information is uploaded or published. Use profileCard_exportPng for a PNG image.",
  input: z.object({}),
  async run(ctx) {
    const { card } = await profileCardGet.run(ctx, {});
    if (!card) throw new MaxError("NOT_FOUND", "Create your card in My Account or with profileCard_update first.");
    return { ...profileCardSvg(card), filename: "max-workspace-card.svg", mimeType: "image/svg+xml" };
  },
});
