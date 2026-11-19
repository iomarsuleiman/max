"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { Button, IconButton } from "@/components/ui";
import { SpaceEditor } from "./SpaceEditor";

const EVENT = "max:edit-space";

/** Opens the floating space editor (Settings closes first, so the whole app is visible). */
export function openSpaceEditor() {
  window.dispatchEvent(new Event(EVENT));
}

/**
 * The space editor as a floating panel over the app, like Arc's: drag colors and watch the sidebar
 * and pages change behind it. Escape or Done closes it; changes save as you go.
 */
export function SpacePanel() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(EVENT, show);
    return () => window.removeEventListener(EVENT, show);
  }, []);
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [open]);
  if (!open) return null;
  return (
    <section className="space-panel" role="dialog" aria-modal="false" aria-label="Edit your space">
      <header className="flex items-center justify-between px-4 pt-3">
        <h2 className="text-[13.5px] font-semibold">Your space</h2>
        <IconButton label="Close" size="md" onClick={() => setOpen(false)}>
          <X className="size-4" />
        </IconButton>
      </header>
      <SpaceEditor />
      <div className="flex justify-end px-4 pb-4">
        <Button size="sm" variant="primary" onClick={() => setOpen(false)}>
          Done
        </Button>
      </div>
    </section>
  );
}
