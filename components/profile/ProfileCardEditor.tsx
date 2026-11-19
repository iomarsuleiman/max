"use client";

import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { IconButton } from "@/components/ui";
import { notifyError, useWorkspace } from "@/components/workspace/context";
import { defaultProfileCard, profileCardSchema, profileCardShapes, profileCardThemes, type ProfileCard as Card } from "@/lib/domain/profileCard";
import { downloadProfileCardPng } from "@/lib/client/profileCardExport";
import { useOp } from "@/lib/client/data";
import { ProfileCard, type CardNote } from "./ProfileCard";


interface CardInfo {
  memberNumber: number | null;
  joinedAt: number | null;
  note: CardNote & { invited: boolean };
}

/**
 * Your membership card, as it appears in About: the card (its note is on the back), your member
 * number and a quiet download button. The artwork is yours as it came: no reshuffling.
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

  return (
    <div className="card-about">
      <div className="card-about-card">
        <ProfileCard card={shown} note={note} />
      </div>
      <div className="card-about-info">
        <p className="card-about-number">{info.data?.memberNumber ? `No. ${info.data.memberNumber.toLocaleString("en-US")}` : "No. …"}</p>
        <div className="mt-2 flex flex-wrap gap-1">
          <IconButton
            label="Download PNG"
            size="md"
            onClick={async () => {
              try {
                await downloadProfileCardPng(shown, note);
                toast.success("Card saved as an image", { duration: 1500 });
              } catch (err) {
                notifyError(err, "Couldn't download your card.");
              }
            }}
          >
            <Download className="size-4" />
          </IconButton>
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
