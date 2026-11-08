"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Shuffle, Trash2 } from "lucide-react";
import { Popover, PopoverClose } from "@/components/ui";
import { EMOJI } from "@/lib/client/emoji";

export function IconPicker({ trigger, onPick, onRemove }: { trigger: ReactNode; onPick: (emoji: string) => void; onRemove?: () => void }) {
  const [query, setQuery] = useState("");
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? EMOJI.filter((x) => x.k.includes(q) || x.e === q) : EMOJI;
  }, [query]);
  return (
    <Popover trigger={trigger} className="w-[min(352px,calc(100vw-24px))] p-2">
      <div className="mb-2 flex items-center gap-1.5">
        <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter…" aria-label="Filter icons" className="h-7 min-w-0 flex-1 rounded-md bg-surface-2 px-2 text-[13px] outline-none focus:shadow-[0_0_0_1px_var(--accent)]" />
        <PopoverClose asChild>
          <button type="button" title="Random" aria-label="Random icon" onClick={() => onPick(EMOJI[Math.floor(Math.random() * EMOJI.length)].e)} className="grid size-7 place-items-center rounded-md text-fg-2 hover:bg-hover">
            <Shuffle className="size-3.5" />
          </button>
        </PopoverClose>
        {onRemove && (
          <PopoverClose asChild>
            <button type="button" title="Remove" aria-label="Remove icon" onClick={onRemove} className="grid size-7 place-items-center rounded-md text-fg-2 hover:bg-hover">
              <Trash2 className="size-3.5" />
            </button>
          </PopoverClose>
        )}
      </div>
      <div className="grid max-h-64 grid-cols-9 gap-0.5 overflow-y-auto" role="listbox" aria-label="Icons">
        {list.map((x) => (
          <PopoverClose asChild key={x.e}>
            <button type="button" role="option" aria-selected={false} aria-label={x.k.split(" ")[0]} title={x.k.split(" ")[0]} onClick={() => onPick(x.e)} className="grid size-9 place-items-center rounded-md text-xl hover:bg-hover">
              {x.e}
            </button>
          </PopoverClose>
        ))}
        {!list.length && <p className="col-span-9 py-6 text-center text-[13px] text-fg-3">No icons match “{query}”.</p>}
      </div>
    </Popover>
  );
}
