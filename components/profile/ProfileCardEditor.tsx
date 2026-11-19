"use client";

import { useEffect, useRef, useState } from "react";
import { Download, Shuffle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui";
import { notifyError, useWorkspace } from "@/components/workspace/context";
import { defaultProfileCard, profileCardSchema, profileCardShapes, profileCardThemes, type ProfileCard as Card } from "@/lib/domain/profileCard";
import { downloadProfileCardPng } from "@/lib/client/profileCardExport";
import { useOp } from "@/lib/client/data";
import { ProfileCard, type CardNote } from "./ProfileCard";

const SUBTITLES = ["Curious explorer", "Quiet daydreamer", "Creative wanderer", "Thoughtful maker", "Bright observer", "Gentle trailblazer"];

interface CardInfo {
  memberNumber: number | null;
  joinedAt: number | null;
  note: CardNote & { invited: boolean };
}

/**
 * Your membership card, as it appears in About: the card (hover it to read the note on the back),
 * your member number and who the note is from. Changing the artwork saves it.
 */
export function ProfileCardEditor() {
  const ws = useWorkspace();
  const info = useOp<CardInfo>("profileCard.get", {});
  const name = ws.settings?.displayName?.trim() || ws.identity.name || "You";
  const [card, setCard] = useState<Card>(() => {
    const saved = profileCardSchema.safeParse(ws.settings?.profileCard);
    const initial = saved.success ? saved.data : defaultProfileCard(name);
    return { ...initial, name, createdAt: ws.settings?.joinedAt ?? initial.createdAt };
  });
  // The card always carries your current name.
  useEffect(() => setCard((c) => (c.name === name ? c : { ...c, name })), [name]);
  const saving = useRef<Promise<unknown> | null>(null);
  const shown: Card = { ...card, memberNumber: info.data?.memberNumber ?? undefined };
  const note: CardNote = info.data?.note ?? { text: "", from: "" };
  const joined = info.data?.joinedAt ?? ws.settings?.joinedAt ?? null;
  const when = joined ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(joined) : null;

  const change = () => {
    const themes = profileCardThemes.filter((t) => t !== card.theme);
    const r = crypto.getRandomValues(new Uint32Array(3));
    const next: Card = { ...card, theme: themes[r[0] % themes.length], shape: profileCardShapes[r[1] % profileCardShapes.length], subtitle: SUBTITLES[r[2] % SUBTITLES.length], pattern: "gradient" };
    setCard(next);
    const parsed = profileCardSchema.safeParse({ ...next, memberNumber: undefined });
    if (!parsed.success) return;
    saving.current = ws.call("profileCard.update", { card: parsed.data }).catch((err) => notifyError(err, "Couldn't save your card's artwork."));
  };

  return (
    <div className="card-about">
      <div className="card-about-card">
        <ProfileCard card={shown} note={note} />
      </div>
      <div className="card-about-info">
        <p className="card-about-number">{info.data?.memberNumber ? `No. ${info.data.memberNumber.toLocaleString("en-US")}` : "No. …"}</p>
        <p className="text-fg-2 text-[13.5px]">{note.from ? `from ${note.from}${when ? `, ${when}` : ""}` : " "}</p>
        <p className="text-fg-3 mt-3 max-w-[18rem] text-[12.5px] leading-relaxed">
          {note.from ? (info.data?.note.invited ? `Hover the card to read ${note.from}'s note on the back.` : "Hover the card to read the note on the back.") : ""}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button size="sm" icon={<Shuffle className="size-3.5" />} onClick={change}>
            Change artwork
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={<Download className="size-3.5" />}
            onClick={async () => {
              try {
                await saving.current;
                await downloadProfileCardPng(shown, note);
                toast.success("Card saved as an image", { duration: 1500 });
              } catch (err) {
                notifyError(err, "Couldn't download your card.");
              }
            }}
          >
            Download PNG
          </Button>
        </div>
      </div>
    </div>
  );
}
