"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Shuffle } from "lucide-react";
import { DynamicIcon, iconNames, type IconName } from "lucide-react/dynamic";
import { Popover, PopoverClose, cn } from "@/components/ui";
import { readLocal, writeLocal } from "@/lib/client/storage";
import { ICON_COLORS, ICON_COLOR_LABEL, PageIcon, iconColorVar, type IconColor } from "@/components/workspace/PageIcon";

type EmojiData = { groups: string[]; emoji: [string, string, number, string][] };
let emojiCache: EmojiData | null = null;

function useEmojiData() {
  const [data, setData] = useState<EmojiData | null>(emojiCache);
  useEffect(() => {
    if (emojiCache) return;
    void import("@/lib/client/emoji-data.json").then((m) => {
      emojiCache = (m.default ?? m) as unknown as EmojiData;
      setData(emojiCache);
    });
  }, []);
  return data;
}

function remember(icon: string) {
  const recent = readLocal<string[]>("recent-icons", []).filter((x) => x !== icon);
  writeLocal("recent-icons", [icon, ...recent].slice(0, 20));
}

/** Notion-style picker: every emoji (by category, searchable) and the full Lucide icon set in colors. */
export function IconPicker({ trigger, onPick, onRemove }: { trigger: ReactNode; onPick: (icon: string) => void; onRemove?: () => void }) {
  const [tab, setTab] = useState<"emoji" | "icons">("icons");
  const [query, setQuery] = useState("");
  const [color, setColor] = useState<IconColor>(() => readLocal<IconColor>("icon-color", "default"));
  const [open, setOpen] = useState(false);
  const pick = (icon: string) => {
    remember(icon);
    onPick(icon);
    setOpen(false);
  };
  return (
    <Popover open={open} onOpenChange={(o) => (setOpen(o), o && setQuery(""))} trigger={trigger} className="w-[min(408px,calc(100vw-24px))] p-0">
      <div className="flex items-center gap-1 border-b border-line px-2 pt-1.5">
        {(["icons", "emoji"] as const).map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)} className={cn("h-8 border-b-2 border-transparent px-2 text-[13px] text-fg-2 hover:text-fg", tab === t && "border-fg font-medium text-fg")}>
            {t === "emoji" ? "Emoji" : "Icons"}
          </button>
        ))}
        {onRemove && (
          <PopoverClose asChild>
            <button type="button" onClick={onRemove} className="ms-auto h-7 rounded-md px-2 text-[13px] text-fg-2 hover:bg-hover">
              Remove
            </button>
          </PopoverClose>
        )}
      </div>
      <div className="flex items-center gap-1.5 p-2">
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={tab === "emoji" ? "Search emoji" : "Search icons"}
          aria-label={tab === "emoji" ? "Search emoji" : "Search icons"}
          className="h-7 min-w-0 flex-1 rounded-md bg-surface-2 px-2 text-[13px] outline-none focus:shadow-[0_0_0_1px_var(--accent)]"
        />
        {tab === "icons" && (
          <div className="flex items-center gap-0.5" role="radiogroup" aria-label="Icon color">
            {(["default", ...ICON_COLORS] as IconColor[]).map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={color === c}
                aria-label={ICON_COLOR_LABEL[c]}
                title={ICON_COLOR_LABEL[c]}
                onClick={() => (setColor(c), writeLocal("icon-color", c))}
                className={cn("grid size-5 place-items-center rounded-full", color === c && "ring-2 ring-line-strong")}
              >
                <span className="size-3 rounded-full" style={{ background: iconColorVar(c) }} />
              </button>
            ))}
          </div>
        )}
        <button type="button" title="Random" aria-label="Random" onClick={() => (tab === "emoji" ? randomEmoji(pick) : pick(`lucide:${iconNames[Math.floor(Math.random() * iconNames.length)]}:${color}`))} className="grid size-7 shrink-0 place-items-center rounded-md text-fg-2 hover:bg-hover">
          <Shuffle className="size-3.5" />
        </button>
      </div>
      {tab === "emoji" ? <EmojiGrid query={query} onPick={pick} /> : <IconGrid query={query} color={color} onPick={pick} />}
    </Popover>
  );
}

function randomEmoji(pick: (e: string) => void) {
  if (emojiCache) pick(emojiCache.emoji[Math.floor(Math.random() * emojiCache.emoji.length)][0]);
}

function EmojiGrid({ query, onPick }: { query: string; onPick: (e: string) => void }) {
  const data = useEmojiData();
  const [recent] = useState(() => readLocal<string[]>("recent-icons", []).filter((x) => !x.startsWith("lucide:")).slice(0, 18));
  const q = query.trim().toLowerCase();
  const groups = useMemo(() => {
    if (!data) return [];
    if (q) return [{ name: "Results", items: data.emoji.filter((e) => e[1].includes(q) || e[3].includes(q)) }];
    return data.groups.map((name, i) => ({ name, items: data.emoji.filter((e) => e[2] === i) })).filter((g) => g.items.length);
  }, [data, q]);
  if (!data) return <div className="skeleton m-2 h-64" />;
  return (
    <div className="max-h-72 overflow-y-auto px-2 pb-2">
      {!q && recent.length > 0 && (
        <section>
          <h4 className="sticky top-0 z-[1] bg-overlay py-1 text-[11.5px] font-medium text-fg-3">Recent</h4>
          <div className="grid grid-cols-10 gap-0.5">
            {recent.map((e) => (
              <button key={e} type="button" aria-label={e} onClick={() => onPick(e)} className="grid size-9 place-items-center rounded-md text-[22px] hover:bg-hover">
                {e}
              </button>
            ))}
          </div>
        </section>
      )}
      {groups.map((g) => (
        <section key={g.name} aria-label={g.name}>
          <h4 className="sticky top-0 z-[1] bg-overlay py-1 text-[11.5px] font-medium text-fg-3">{g.name}</h4>
          <div className="grid grid-cols-10 gap-0.5">
            {g.items.map(([e, label]) => (
              <button key={e} type="button" title={label} aria-label={label} onClick={() => onPick(e)} className="grid size-9 place-items-center rounded-md text-[22px] hover:bg-hover">
                {e}
              </button>
            ))}
          </div>
        </section>
      ))}
      {q && !groups[0]?.items.length && <p className="py-6 text-center text-[13px] text-fg-3">No emoji match “{query}”.</p>}
    </div>
  );
}

function IconGrid({ query, color, onPick }: { query: string; color: IconColor; onPick: (icon: string) => void }) {
  const [limit, setLimit] = useState(160);
  const q = query.trim().toLowerCase().replace(/\s+/g, "-");
  const names = useMemo(() => (q ? iconNames.filter((n) => n.includes(q)) : iconNames), [q]);
  const [recent] = useState(() => readLocal<string[]>("recent-icons", []).filter((x) => x.startsWith("lucide:")).slice(0, 10));
  return (
    <div className="max-h-72 overflow-y-auto px-2 pb-2">
      {!q && recent.length > 0 && (
        <section>
          <h4 className="py-1 text-[11.5px] font-medium text-fg-3">Recent</h4>
          <div className="grid grid-cols-10 gap-0.5">
            {recent.map((icon) => (
              <button key={icon} type="button" aria-label={icon.split(":")[1]} onClick={() => onPick(icon)} className="grid size-9 place-items-center rounded-md hover:bg-hover">
                <PageIcon icon={icon} size={20} />
              </button>
            ))}
          </div>
        </section>
      )}
      <h4 className="py-1 text-[11.5px] font-medium text-fg-3">{q ? `${names.length} icons` : `All icons (${iconNames.length})`}</h4>
      <div className="grid grid-cols-10 gap-0.5">
        {names.slice(0, limit).map((n) => (
          <button key={n} type="button" title={n} aria-label={n.replace(/-/g, " ")} onClick={() => onPick(`lucide:${n}:${color}`)} className="grid size-9 place-items-center rounded-md hover:bg-hover">
            <DynamicIcon name={n as IconName} size={20} strokeWidth={1.9} color={iconColorVar(color)} fallback={() => <span className="size-5" />} />
          </button>
        ))}
      </div>
      {names.length > limit && (
        <button type="button" onClick={() => setLimit((l) => l + 240)} className="mt-2 h-7 w-full rounded-md text-[12.5px] text-fg-2 hover:bg-hover">
          Show more ({names.length - limit} left)
        </button>
      )}
      {!names.length && <p className="py-6 text-center text-[13px] text-fg-3">No icons match “{query}”.</p>}
    </div>
  );
}
