"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Search, Shuffle, Upload } from "lucide-react";
import { DynamicIcon, iconNames, type IconName } from "lucide-react/dynamic";
import { Button, Input, Popover, PopoverClose, Switch, cn } from "@/components/ui";
import { readLocal, writeLocal } from "@/lib/client/storage";
import { useUploader } from "@/lib/client/upload";
import { notifyError } from "@/components/workspace/context";
import { ICON_COLOR_LABEL, PageIcon, iconColorVar, type IconColor } from "@/components/workspace/PageIcon";

type EmojiData = { groups: string[]; emoji: [string, string, number, string, number][] };
let emojiCache: EmojiData | null = null;

function useEmojiData() {
  const [data, setData] = useState<EmojiData | null>(emojiCache);
  useEffect(() => {
    if (emojiCache) return;
    void import("@/lib/client/emoji-data.json").then((m) => {
      const all = (m.default ?? m) as unknown as EmojiData;
      const max = supportedEmojiVersion(all.emoji);
      // Hide emoji newer than the device's emoji font, which would show as boxes.
      emojiCache = { groups: all.groups, emoji: all.emoji.filter((e) => e[4] <= max) };
      setData(emojiCache);
    });
  }, []);
  return data;
}

/** True when the character draws in color (a real emoji glyph, not a box with its code). */
function drawsInColor(ctx: CanvasRenderingContext2D, emoji: string) {
  ctx.clearRect(0, 0, 20, 20);
  ctx.fillText(emoji, 0, 16);
  const px = ctx.getImageData(0, 0, 20, 20).data;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] > 0 && Math.max(px[i], px[i + 1], px[i + 2]) - Math.min(px[i], px[i + 1], px[i + 2]) > 40) return true;
  }
  return false;
}

/** The newest emoji version this device can draw: one test emoji per version, newest first. Cached per browser. */
function supportedEmojiVersion(emoji: EmojiData["emoji"]): number {
  const key = `emoji-version:${typeof navigator === "undefined" ? "" : navigator.userAgent}`;
  const cached = readLocal<number | null>(key, null);
  if (cached !== null) return cached;
  let result = Infinity;
  try {
    const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
    if (ctx) {
      ctx.canvas.width = ctx.canvas.height = 20;
      ctx.font = `16px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji","Twemoji Mozilla",sans-serif`;
      const versions = [...new Set(emoji.map((e) => e[4]))].sort((a, b) => b - a);
      const probe = (v: number) => emoji.find((e) => e[4] === v && !e[0].includes("\u200d") && !/[\u{1F1E6}-\u{1F1FF}]/u.test(e[0]))?.[0];
      // A device with no color emoji font at all draws everything in mono: keep the full set then.
      if (drawsInColor(ctx, "😀")) result = versions.find((v) => {
        const sample = probe(v);
        return sample ? drawsInColor(ctx, sample) : false;
      }) ?? 1;
    }
  } catch {
    /* keep everything */
  }
  writeLocal(key, Number.isFinite(result) ? result : 999);
  return result;
}

function remember(icon: string) {
  const recent = readLocal<string[]>("recent-icons", []).filter((x) => x !== icon);
  writeLocal("recent-icons", [icon, ...recent].slice(0, 24));
}

/** Notion's swatch order: two rows of five. */
const SWATCHES: IconColor[] = ["default", "gray", "brown", "yellow", "orange", "green", "blue", "purple", "pink", "red"];
const COLUMNS = 12;
type Tab = "emoji" | "icons" | "upload";

/**
 * Notion-style icon picker: Emoji, Icons (Lucide in ten colors) and Upload (an image file or link).
 * Filter, shuffle, a color menu with "Ask every time", recents, arrow-key navigation and endless scrolling.
 */
export function IconPicker({ trigger, onPick, onRemove, pageId = null }: { trigger: ReactNode; onPick: (icon: string) => void; onRemove?: () => void; pageId?: string | null }) {
  const [tab, setTab] = useState<Tab>(() => readLocal<Tab>("icon-tab", "icons"));
  const [query, setQuery] = useState("");
  const [color, setColor] = useState<IconColor>(() => readLocal<IconColor>("icon-color", "default"));
  const [askColor, setAskColor] = useState(() => readLocal<boolean>("icon-ask-color", false));
  const [colorsOpen, setColorsOpen] = useState(false);
  const [choosing, setChoosing] = useState<string | null>(null); // icon name waiting for a color
  const [open, setOpen] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);

  const pick = (icon: string) => {
    remember(icon);
    onPick(icon);
    setOpen(false);
  };
  const pickIcon = (name: string) => (askColor ? setChoosing(name) : pick(`lucide:${name}:${color}`));
  const chooseTab = (t: Tab) => {
    setTab(t);
    setQuery("");
    setColorsOpen(false);
    setChoosing(null);
    writeLocal("icon-tab", t);
  };
  const shuffle = () => {
    if (tab === "emoji" && emojiCache) pick(emojiCache.emoji[Math.floor(Math.random() * emojiCache.emoji.length)][0]);
    if (tab === "icons") pick(`lucide:${iconNames[Math.floor(Math.random() * iconNames.length)]}:${color}`);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setQuery("");
          setColorsOpen(false);
          setChoosing(null);
        }
      }}
      trigger={trigger}
      className="flex h-[min(456px,72dvh)] w-[min(520px,calc(100vw-24px))] flex-col overflow-hidden p-0"
    >
      <div className="flex items-end gap-1 border-b border-line px-2" role="tablist" aria-label="Icon source">
        {(["emoji", "icons", "upload"] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => chooseTab(t)}
            className={cn("relative h-9 px-2 text-[13.5px] text-fg-2 hover:text-fg", tab === t && "font-medium text-fg after:absolute after:inset-x-1.5 after:bottom-0 after:h-0.5 after:rounded-full after:bg-fg")}
          >
            {t === "emoji" ? "Emoji" : t === "icons" ? "Icons" : "Upload"}
          </button>
        ))}
        {onRemove && (
          <PopoverClose asChild>
            <button type="button" onClick={onRemove} className="ms-auto mb-1 h-7 rounded-md px-2 text-[13.5px] text-fg-2 hover:bg-hover">
              Remove
            </button>
          </PopoverClose>
        )}
      </div>

      {tab === "upload" ? (
        <UploadTab pageId={pageId} onPick={pick} />
      ) : (
        <>
          <div className="relative flex items-center gap-1.5 px-2.5 pb-1.5 pt-2.5">
            <label className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md bg-surface-2 px-2 shadow-[inset_0_0_0_1px_var(--line)] focus-within:shadow-[inset_0_0_0_1px_var(--accent)]">
              <Search className="size-4 shrink-0 text-fg-3" aria-hidden />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    gridRef.current?.querySelector<HTMLButtonElement>("[data-cell]")?.focus();
                  }
                }}
                placeholder="Filter…"
                aria-label={tab === "emoji" ? "Filter emoji" : "Filter icons"}
                className="h-full min-w-0 flex-1 bg-transparent text-[13.5px] outline-none placeholder:text-fg-3"
              />
            </label>
            <ToolButton label={tab === "emoji" ? "Random emoji" : "Random icon"} onClick={shuffle}>
              <Shuffle className="size-4" />
            </ToolButton>
            {tab === "icons" && (
              <ToolButton label={`Icon color: ${ICON_COLOR_LABEL[color]}`} onClick={() => setColorsOpen((v) => !v)} pressed={colorsOpen}>
                <span className="size-3.5 rounded-full shadow-[0_0_0_1px_var(--line-strong)]" style={{ background: iconColorVar(color) }} />
              </ToolButton>
            )}
            {colorsOpen && tab === "icons" && (
              <div className="absolute end-2.5 top-[calc(100%-2px)] z-10 w-[200px] rounded-lg bg-overlay p-2.5 shadow-pop" role="dialog" aria-label="Icon color">
                <div className="grid grid-cols-5 gap-1.5" role="radiogroup" aria-label="Icon color">
                  {SWATCHES.map((c) => (
                    <button
                      key={c}
                      type="button"
                      role="radio"
                      aria-checked={color === c}
                      aria-label={ICON_COLOR_LABEL[c]}
                      title={ICON_COLOR_LABEL[c]}
                      onClick={() => {
                        setColor(c);
                        writeLocal("icon-color", c);
                      }}
                      className={cn("grid size-8 place-items-center rounded-full hover:bg-hover", color === c && "shadow-[0_0_0_2px_var(--accent)]")}
                    >
                      <span className="size-5 rounded-full shadow-[0_0_0_1px_var(--line)]" style={{ background: iconColorVar(c) }} />
                    </button>
                  ))}
                </div>
                <div className="mt-2.5 flex items-center justify-between border-t border-line pt-2.5 text-[13px] text-fg">
                  <span aria-hidden>Ask every time</span>
                  <Switch
                    label="Ask for a color every time"
                    checked={askColor}
                    onCheckedChange={(v) => {
                      setAskColor(v);
                      writeLocal("icon-ask-color", v);
                    }}
                  />
                </div>
              </div>
            )}
          </div>
          <div ref={gridRef} className="relative min-h-0 flex-1 overflow-y-auto px-2.5 pb-2.5" onKeyDown={gridKeys}>
            {tab === "emoji" ? <EmojiGrid query={query} onPick={pick} /> : <IconGrid query={query} color={color} onPick={pickIcon} />}
          </div>
          {choosing && (
            <div className="border-t border-line bg-overlay px-2.5 py-2" role="dialog" aria-label="Choose a color">
              <p className="mb-1.5 text-[12px] text-fg-3">Choose a color for “{choosing.replace(/-/g, " ")}”</p>
              <div className="flex flex-wrap gap-1">
                {SWATCHES.map((c) => (
                  <button key={c} type="button" data-cell aria-label={ICON_COLOR_LABEL[c]} title={ICON_COLOR_LABEL[c]} onClick={() => pick(`lucide:${choosing}:${c}`)} className="grid size-10 place-items-center rounded-md hover:bg-hover focus-visible:bg-hover focus-visible:outline-none">
                    <DynamicIcon name={choosing as IconName} size={22} strokeWidth={1.9} color={iconColorVar(c)} />
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </Popover>
  );
}

function ToolButton({ label, onClick, pressed, children }: { label: string; onClick: () => void; pressed?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      onClick={onClick}
      className={cn("grid size-8 shrink-0 place-items-center rounded-md text-fg-2 shadow-[inset_0_0_0_1px_var(--line)] hover:bg-hover", pressed && "bg-hover")}
    >
      {children}
    </button>
  );
}

/** Arrow keys move between cells (12 per row), like Notion. */
function gridKeys(e: KeyboardEvent<HTMLDivElement>) {
  const moves: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: COLUMNS, ArrowUp: -COLUMNS };
  const delta = moves[e.key];
  if (!delta) return;
  const cells = [...e.currentTarget.querySelectorAll<HTMLButtonElement>("[data-cell]")];
  const i = cells.indexOf(document.activeElement as HTMLButtonElement);
  if (i < 0) return;
  e.preventDefault();
  const rtl = getComputedStyle(e.currentTarget).direction === "rtl" && Math.abs(delta) === 1;
  const next = cells[Math.max(0, Math.min(cells.length - 1, i + (rtl ? -delta : delta)))];
  next?.focus();
  next?.scrollIntoView({ block: "nearest" });
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <h4 className="sticky top-0 z-[1] bg-overlay pb-1 pt-2 text-[12px] font-medium text-fg-3">{children}</h4>;
}

const cell = "grid size-10 place-items-center rounded-md hover:bg-hover focus-visible:bg-hover focus-visible:outline-none";

/** Grows the rendered list as the end scrolls into view. */
function useMore(total: number, step: number) {
  const [limit, setLimit] = useState(step);
  const [sentinel, setSentinel] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!sentinel || limit >= total) return;
    const io = new IntersectionObserver((entries) => entries.some((x) => x.isIntersecting) && setLimit((l) => l + step), { rootMargin: "240px" });
    io.observe(sentinel);
    return () => io.disconnect();
  }, [sentinel, limit, total, step]);
  return [limit, setSentinel] as const;
}

function EmojiGrid({ query, onPick }: { query: string; onPick: (e: string) => void }) {
  const data = useEmojiData();
  const [recent] = useState(() => readLocal<string[]>("recent-icons", []).filter((x) => !x.startsWith("lucide:") && !/^(https:|max-asset:)/.test(x)).slice(0, COLUMNS * 2));
  const q = query.trim().toLowerCase();
  const groups = useMemo(() => {
    if (!data) return [];
    if (q) return [{ name: "Results", items: data.emoji.filter((e) => e[1].includes(q) || e[3].includes(q)) }];
    return data.groups.map((name, i) => ({ name, items: data.emoji.filter((e) => e[2] === i) })).filter((g) => g.items.length);
  }, [data, q]);
  const total = groups.reduce((n, g) => n + g.items.length, 0);
  const [limit, setSentinel] = useMore(total, 360);
  // Render groups in order until the running limit is used up.
  const shown = useMemo(() => {
    const starts = groups.map((_, i) => groups.slice(0, i).reduce((n, g) => n + g.items.length, 0));
    return groups.map((g, i) => ({ name: g.name, items: g.items.slice(0, Math.max(0, limit - starts[i])) }));
  }, [groups, limit]);
  if (!data) return <div className="skeleton mt-2 h-64" />;
  return (
    <>
      {!q && recent.length > 0 && (
        <section aria-label="Recent">
          <SectionTitle>Recent</SectionTitle>
          <div className="grid grid-cols-12">
            {recent.map((e) => (
              <button key={e} type="button" data-cell aria-label={e} onClick={() => onPick(e)} className={cn(cell, "text-[26px] leading-none")}>
                {e}
              </button>
            ))}
          </div>
        </section>
      )}
      {shown.map((g) =>
        !g.items.length ? null : (
          <section key={g.name} aria-label={g.name}>
            <SectionTitle>{g.name}</SectionTitle>
            <div className="grid grid-cols-12">
              {g.items.map(([e, label]) => (
                <button key={e} type="button" data-cell title={label} aria-label={label} onClick={() => onPick(e)} className={cn(cell, "text-[26px] leading-none")}>
                  {e}
                </button>
              ))}
            </div>
          </section>
        ),
      )}
      <div ref={setSentinel} aria-hidden />
      {q && !total && <p className="py-8 text-center text-[13px] text-fg-3">No emoji match “{query}”.</p>}
    </>
  );
}

function IconGrid({ query, color, onPick }: { query: string; color: IconColor; onPick: (name: string) => void }) {
  const q = query.trim().toLowerCase().replace(/\s+/g, "-");
  const names = useMemo(() => (q ? iconNames.filter((n) => n.includes(q)) : iconNames), [q]);
  const [recent] = useState(() => readLocal<string[]>("recent-icons", []).filter((x) => x.startsWith("lucide:")).slice(0, COLUMNS));
  const [limit, setSentinel] = useMore(names.length, 240);
  return (
    <>
      {!q && recent.length > 0 && (
        <section aria-label="Recent">
          <SectionTitle>Recent</SectionTitle>
          <div className="grid grid-cols-12">
            {recent.map((icon) => (
              <button key={icon} type="button" data-cell aria-label={icon.split(":")[1].replace(/-/g, " ")} onClick={() => onPick(icon.split(":")[1])} className={cell}>
                <PageIcon icon={icon} size={22} />
              </button>
            ))}
          </div>
        </section>
      )}
      <section aria-label="Icons">
        <SectionTitle>{q ? `${names.length} ${names.length === 1 ? "icon" : "icons"}` : "Icons"}</SectionTitle>
        <div className="grid grid-cols-12">
          {names.slice(0, limit).map((n) => (
            <button key={n} type="button" data-cell title={n.replace(/-/g, " ")} aria-label={n.replace(/-/g, " ")} onClick={() => onPick(n)} className={cell}>
              <DynamicIcon name={n as IconName} size={22} strokeWidth={1.9} color={iconColorVar(color)} fallback={() => <span className="size-[22px]" />} />
            </button>
          ))}
        </div>
      </section>
      <div ref={setSentinel} aria-hidden />
      {!names.length && <p className="py-8 text-center text-[13px] text-fg-3">No icons match “{query}”.</p>}
    </>
  );
}

const ICON_MAX_BYTES = 5 * 1024 * 1024;

function UploadTab({ pageId, onPick }: { pageId: string | null; onPick: (icon: string) => void }) {
  const upload = useUploader();
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [link, setLink] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const send = async (file: File | undefined | null) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) return notifyError(new Error("Choose an image (PNG, JPG, GIF, WebP or SVG)."));
    if (file.size > ICON_MAX_BYTES) return notifyError(new Error("Icons can be up to 5 MB."));
    setBusy(true);
    try {
      onPick(await upload(file, pageId, "Page icon"));
    } catch (err) {
      notifyError(err, "Couldn't upload the icon.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-3 p-3"
      onPaste={(e) => {
        const file = [...e.clipboardData.files].find((f) => f.type.startsWith("image/"));
        if (file) {
          e.preventDefault();
          void send(file);
        }
      }}
    >
      <div
        onDragOver={(e) => (e.preventDefault(), setOver(true))}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void send(e.dataTransfer.files[0]);
        }}
        className={cn("grid flex-1 place-items-center rounded-lg border border-dashed border-line-strong p-4 text-center transition-colors", over && "border-accent bg-accent-soft")}
      >
        <div className="grid justify-items-center gap-2">
          <Button variant="secondary" icon={<Upload className="size-4" />} pending={busy} onClick={() => fileRef.current?.click()}>
            Upload an image
          </Button>
          <p className="text-[12.5px] text-fg-3">Or drop or paste one here. Square images of at least 280 × 280 pixels look best.</p>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => void send(e.target.files?.[0])} />
        </div>
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const url = link.trim();
          if (!/^https:\/\/\S+$/.test(url)) return notifyError(new Error("Paste an https:// image link."));
          onPick(url);
        }}
      >
        <Input value={link} onChange={(e) => setLink(e.target.value)} placeholder="Paste an image link…" aria-label="Image link" className="h-8 flex-1" />
        <Button type="submit" variant="primary" size="sm" disabled={!link.trim()}>
          Submit
        </Button>
      </form>
    </div>
  );
}
