"use client";

import { useEffect, useState } from "react";
import { Download, Share } from "@/components/icons";
import { toast } from "sonner";
import { Button } from "@/components/ui";
import { notifyError, useWorkspace } from "@/components/workspace/context";
import { cardPalette, defaultProfileCard, profileCardSchema, profileCardShapes, profileCardThemes, type ProfileCard as Card } from "@/lib/domain/profileCard";
import { downloadProfileCardPng, shareProfileCard } from "@/lib/client/profileCardExport";
import { inviteUrl } from "@/lib/domain/profileCardImage";
import { useOp } from "@/lib/client/data";
import { ProfileCard, type CardNote } from "./ProfileCard";


interface CardInfo {
  memberNumber: number | null;
  joinedAt: number | null;
  note: CardNote & { invited: boolean };
  username: string | null;
}

/**
 * Your membership card, as it appears in About: the card (hover to see the note on the back), your
 * member number, who welcomed you, and Download / Share. The artwork is yours as it came.
 */
export function ProfileCardEditor() {
  const ws = useWorkspace();
  const info = useOp<CardInfo>("profileCard.get", {});
  const name = ws.settings?.displayName?.trim() || ws.identity.name || "You";
  const saved = profileCardSchema.safeParse(ws.settings?.profileCard);
  const [card, setCard] = useState<Card>(() => {
    const initial = saved.success ? saved.data : defaultProfileCard(name);
    return { ...initial, name, createdAt: ws.settings?.joinedAt ?? initial.createdAt };
  });
  // The card always carries your current name.
  useEffect(() => setCard((c) => (c.name === name ? c : { ...c, name })), [name]);
  const memberNumber = info.data?.memberNumber ?? undefined;
  // Artwork chosen earlier is kept; everyone else gets their own, fixed by their member number.
  const shown: Card = { ...card, ...(saved.success ? {} : artFor(memberNumber)), memberNumber };
  const note: CardNote = info.data?.note ?? { text: "", from: "" };

  const invite = inviteUrl(memberNumber, info.data?.username);
  const palette = cardPalette(shown.theme);
  const joined = ws.settings?.joinedAt ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" }).format(ws.settings.joinedAt) : null;

  return (
    // A stage lit in the card's own colors.
    <div className="card-about" style={{ ["--glow-1" as string]: palette.first, ["--glow-2" as string]: palette.second }}>
      <div className="card-about-card">
        <ProfileCard card={shown} note={note} invite={invite} />
      </div>
      <div className="card-about-info">
        <p className="card-about-eyebrow">Max member</p>
        <p className="card-about-number">No. {info.data?.memberNumber ? info.data.memberNumber.toLocaleString("en-US") : "…"}</p>
        {joined && <p className="mt-1 text-[13px] text-fg-3">Joined {joined}</p>}
        {note.from && <p className="card-about-from">{info.data?.memberNumber === 1 ? "with a note to yourself, for building this" : `with a note from ${note.from}`}</p>}
        <div className="card-about-actions">
          <Button
            size="sm"
            variant="primary"
            icon={<Share className="size-3.5" />}
            onClick={async () => {
              try {
                if (await shareProfileCard(shown, note, invite)) return;
                await navigator.clipboard.writeText(invite);
                toast.success("Invite link copied", { duration: 1500 });
              } catch (err) {
                notifyError(err, "Couldn't share your card.");
              }
            }}
          >
            Share
          </Button>
          <Button
            size="sm"
            variant="secondary"
            icon={<Download className="size-3.5" />}
            onClick={async () => {
              try {
                await downloadProfileCardPng(shown, note, invite);
                toast.success("Card saved, both sides", { duration: 1500 });
              } catch (err) {
                notifyError(err, "Couldn't download your card.");
              }
            }}
          >
            Download
          </Button>
        </div>
      </div>
    </div>
  );
}

/** The same member number always gets the same artwork; different numbers spread across all of them. */
function artFor(memberNumber: number | undefined): Partial<Card> {
  if (!memberNumber) return {};
  const n = Math.imul(memberNumber ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  return { theme: profileCardThemes[n % profileCardThemes.length], shape: profileCardShapes[(n >>> 8) % profileCardShapes.length] };
}
