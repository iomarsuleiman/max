"use client";

import { useId, useState, type FormEvent } from "react";
import { Shuffle } from "lucide-react";
import { toast } from "sonner";
import { Button, Field, Input } from "@/components/ui";
import { notifyError, useWorkspace } from "@/components/workspace/context";
import { defaultProfileCard, profileCardSchema, type ProfileCard as Card } from "@/lib/domain/profileCard";
import { ProfileCard } from "./ProfileCard";
import { downloadProfileCardPng } from "@/lib/client/profileCardExport";

export function ProfileCardEditor() {
  const ws = useWorkspace();
  const id = useId();
  const [card, setCard] = useState(() => {
    const saved = profileCardSchema.safeParse(ws.settings?.profileCard);
    return saved.success ? saved.data : defaultProfileCard(ws.settings?.displayName || ws.identity.name);
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
      await ws.call("profileCard.update", { card: parsed.data });
      setCard(parsed.data);
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
            const themes: Card["theme"][] = ["sunset", "ocean", "sage", "clay", "lilac"];
            const shapes: Card["shape"][] = ["arch", "leaf", "orbit"];
            const next = themes.filter((theme) => theme !== card.theme);
            const random = crypto.getRandomValues(new Uint32Array(2));
            setCard({ ...card, theme: next[random[0] % next.length], shape: shapes[random[1] % shapes.length], pattern: "gradient" });
          }}
        >
          Shuffle design
        </Button>
        <p className="text-fg-3 text-center text-xs">The QR opens Max. Your workspace stays private.</p>
      </div>
      <div className="card-studio-controls">
        <Field label="Card name" htmlFor={`${id}-name`}>
          <Input id={`${id}-name`} value={card.name} maxLength={80} required dir="auto" onChange={(e) => setCard({ ...card, name: e.target.value })} />
        </Field>
        <details className="card-details">
          <summary>More about you</summary>
          <Field label="About you" htmlFor={`${id}-bio`} help={`${card.bio.length}/180 characters`}>
            <textarea
              id={`${id}-bio`}
              value={card.bio}
              maxLength={180}
              rows={3}
              dir="auto"
              onChange={(e) => setCard({ ...card, bio: e.target.value })}
              className="border-line-strong bg-canvas focus:border-accent focus:ring-accent-soft w-full resize-y rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2"
              placeholder="Collecting ideas, making things."
            />
          </Field>
          <Field label="Card subtitle" htmlFor={`${id}-subtitle`}>
            <Input
              id={`${id}-subtitle`}
              value={card.subtitle}
              maxLength={60}
              dir="auto"
              onChange={(event) => setCard({ ...card, subtitle: event.target.value })}
              placeholder="Curious explorer"
            />
          </Field>
        </details>
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
