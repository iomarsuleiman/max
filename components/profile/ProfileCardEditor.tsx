"use client";

import { useId, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button, Field, Input, cn } from "@/components/ui";
import { notifyError, useWorkspace } from "@/components/workspace/context";
import { defaultProfileCard, profileCardSchema, type ProfileCard as Card } from "@/lib/domain/profileCard";
import { ProfileCard } from "./ProfileCard";
import { downloadProfileCardPng } from "@/lib/client/profileCardExport";

const colors = [
  { value: "sunset", label: "Sunset", color: "#ad3e10" },
  { value: "ocean", label: "Ocean", color: "#264d60" },
  { value: "sage", label: "Sage", color: "#355244" },
  { value: "clay", label: "Clay", color: "#754b3d" },
  { value: "lilac", label: "Lilac", color: "#534164" },
] satisfies { value: Card["theme"]; label: string; color: string }[];
const patterns = [
  { value: "plain", label: "Plain" },
  { value: "gradient", label: "Gradient" },
  { value: "dots", label: "Dots" },
] satisfies { value: Card["pattern"]; label: string }[];

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
    <form onSubmit={save} className="grid gap-5">
      <div>
        <h3 className="text-base font-semibold">Make this space yours</h3>
        <p className="text-fg-2 mt-1 text-[13px]">Your card is private to this workspace. Change it whenever you like.</p>
      </div>
      <ProfileCard card={card} />
      <Field label="Card name" htmlFor={`${id}-name`}>
        <Input id={`${id}-name`} value={card.name} maxLength={80} required dir="auto" onChange={(e) => setCard({ ...card, name: e.target.value })} />
      </Field>
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
      <fieldset>
        <legend className="mb-2 text-[13px] font-medium">Artwork shape</legend>
        <div className="flex flex-wrap gap-2">
          {(["arch", "leaf", "orbit"] as const).map((shape) => (
            <label
              key={shape}
              className={cn(
                "focus-within:ring-accent flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm capitalize focus-within:ring-2",
                card.shape === shape ? "border-accent bg-accent-soft" : "border-line-strong",
              )}
            >
              <input
                type="radio"
                name={`${id}-shape`}
                checked={card.shape === shape}
                onChange={() => setCard({ ...card, shape })}
                className="size-3 accent-[var(--accent)]"
              />
              {shape}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="mb-2 text-[13px] font-medium">Card color</legend>
        <div className="flex flex-wrap gap-2">
          {colors.map((option) => (
            <label
              key={option.value}
              className={cn(
                "focus-within:ring-accent flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm focus-within:ring-2",
                card.theme === option.value ? "border-accent bg-accent-soft" : "border-line-strong",
              )}
            >
              <input
                type="radio"
                name={`${id}-color`}
                value={option.value}
                checked={card.theme === option.value}
                onChange={() => setCard({ ...card, theme: option.value })}
                className="size-3 accent-[var(--accent)]"
              />
              <span aria-hidden="true" className="size-4 rounded-full" style={{ backgroundColor: option.color }} />
              {option.label}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="mb-2 text-[13px] font-medium">Card pattern</legend>
        <div className="flex flex-wrap gap-2">
          {patterns.map((option) => (
            <label
              key={option.value}
              className={cn(
                "focus-within:ring-accent flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm focus-within:ring-2",
                card.pattern === option.value ? "border-accent bg-accent-soft" : "border-line-strong",
              )}
            >
              <input
                type="radio"
                name={`${id}-pattern`}
                value={option.value}
                checked={card.pattern === option.value}
                onChange={() => setCard({ ...card, pattern: option.value })}
                className="size-3 accent-[var(--accent)]"
              />
              {option.label}
            </label>
          ))}
        </div>
      </fieldset>
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
    </form>
  );
}
