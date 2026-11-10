"use client";

import { useId, useState, type FormEvent } from "react";
import { Shuffle } from "lucide-react";
import { toast } from "sonner";
import { Button, Field, Input } from "@/components/ui";
import { notifyError, useWorkspace } from "@/components/workspace/context";
import { defaultProfileCard, profileCardSchema, profileCardThemes, profileCardShapes, type ProfileCard as Card } from "@/lib/domain/profileCard";
import { ProfileCard } from "./ProfileCard";
import { downloadProfileCardPng } from "@/lib/client/profileCardExport";

export function ProfileCardEditor() {
  const ws = useWorkspace();
  const id = useId();
  const [card, setCard] = useState<Card>(() => {
    const saved = profileCardSchema.safeParse(ws.settings?.profileCard);
    const initial = saved.success ? { ...saved.data, name: ws.settings?.displayName?.trim() || saved.data.name } : defaultProfileCard(ws.settings?.displayName || ws.identity.name);
    return { ...initial, createdAt: ws.settings?.joinedAt ?? initial.createdAt };
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = profileCardSchema.safeParse(card);
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await ws.call<{ card: Card }>("profileCard.update", { card: parsed.data });
      setCard(result.card);
      toast.success("Profile card saved");
    } catch (err) {
      notifyError(err, "Couldn't save your card. Your draft is still here.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={save} className="card-studio">
      <div className="card-studio-intro">
        <h3 className="text-base font-semibold">Welcome to Max.</h3>
        <p className="text-fg-2 mt-1 text-[13px]">A little membership card, just for you. Give it your name and find a design that feels right.</p>
      </div>
      <div className="card-studio-preview">
        <div className="card-outline">
          <span className="card-outline-label">YOUR MAX MEMBERSHIP CARD</span>
          <ProfileCard card={card} />
        </div>
        <Button
          icon={<Shuffle className="size-4" />}
          onClick={() => {
            const next = profileCardThemes.filter((theme) => theme !== card.theme);
            const random = crypto.getRandomValues(new Uint32Array(3));
            const subtitles = ["Curious explorer", "Quiet daydreamer", "Creative wanderer", "Thoughtful maker", "Bright observer", "Gentle trailblazer"];
            setCard({ ...card, theme: next[random[0] % next.length], shape: profileCardShapes[random[1] % profileCardShapes.length], subtitle: subtitles[random[2] % subtitles.length], pattern: "gradient" });
          }}
        >
          Change
        </Button>
        <p className="text-fg-3 text-center text-xs">The QR opens Max. Your workspace stays private.</p>
      </div>
      <div className="card-studio-controls">
        <Field label="Name" htmlFor={`${id}-name`} help="Used on your card and throughout Max.">
          <Input id={`${id}-name`} value={card.name} maxLength={80} required dir="auto" onChange={(e) => setCard({ ...card, name: e.target.value })} />
        </Field>
        {error && (
          <p role="alert" className="text-danger text-sm">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="primary" pending={busy}>
            Save my card
          </Button>
          <Button
            disabled={busy || !card.name.trim()}
            onClick={async () => {
              setBusy(true);
              try {
                await downloadProfileCardPng(card);
              } catch (err) {
                notifyError(err, "Couldn't download your card.");
              } finally {
                setBusy(false);
              }
            }}
          >
            Download PNG
          </Button>
        </div>
      </div>
    </form>
  );
}
