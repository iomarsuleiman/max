"use client";

import { useEffect, useState } from "react";
import { Button, Dialog, Field, Input, Textarea } from "@/components/ui";
import type { MaxEditorType } from "@/components/editor/blocks";

/** Alt text and caption for an image block. */
export function ImageDetailsDialog({ target, onClose }: { target: { blockId: string; editor: MaxEditorType } | null; onClose: () => void }) {
  const block = target ? (target.editor.getBlock(target.blockId) as { props: { alt?: string; caption?: string } } | undefined) : undefined;
  const [alt, setAlt] = useState("");
  const [caption, setCaption] = useState("");
  useEffect(() => {
    setAlt(block?.props.alt ?? "");
    setCaption(block?.props.caption ?? "");
  }, [target]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Dialog
      open={!!target}
      onOpenChange={(o) => !o && onClose()}
      title="Image details"
      description="A short description helps screen readers and search."
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              if (target) target.editor.updateBlock(target.blockId, { props: { alt: alt.trim().slice(0, 500), caption: caption.trim().slice(0, 500) } } as never);
              onClose();
            }}
          >
            Save details
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Field label="Description (alt text)" htmlFor="img-alt" help="What's in the image, in a sentence.">
          <Textarea id="img-alt" rows={3} value={alt} onChange={(e) => setAlt(e.target.value)} />
        </Field>
        <Field label="Caption" htmlFor="img-caption" help="Shown under the image.">
          <Input id="img-caption" value={caption} onChange={(e) => setCaption(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}
