"use client";

import { useEffect, useId, useRef, useState } from "react";
import { BookOpen, ChevronDown, FileText, Folder, LayoutGrid, Table2 } from "lucide-react";
import { LogoMark } from "@/components/brand/Logo";
import { WaveRule } from "@/components/brand/WaveRule";

const steps = [
  {
    title: "Your pages come with you",
    body: "Choose what to share from Notion, then bring private copies into Max. Your originals stay right where they are.",
  },
  { title: "Make this space yours", body: "A color, a shape, a few words. Create a little card that feels like you, and change it whenever you like." },
  { title: "A different way to see it", body: "A table for the details. A board for the bigger picture. Change the view without moving your information." },
];
const palettes = { ocean: "#27596e", sage: "#3c5c3e", clay: "#854733" };
const paletteOptions: (keyof typeof palettes)[] = ["ocean", "sage", "clay"];
const sampleRows = [
  { title: "Collect ideas", status: "In progress" },
  { title: "Make a little room", status: "To do" },
  { title: "Try something new", status: "To do" },
];

/** Small HTML previews, not a live workspace, video, or a second copy of the editor. */
export default function Walkthrough() {
  const id = useId();
  const [active, setActive] = useState(0);
  const [palette, setPalette] = useState<keyof typeof palettes>("ocean");
  const [view, setView] = useState<"table" | "board">("table");
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const desktop = matchMedia("(min-width: 1024px)");
    let observer: IntersectionObserver | undefined;
    const observe = () => {
      observer?.disconnect();
      if (!desktop.matches) return;
      observer = new IntersectionObserver(
        (entries) => {
          const visible = entries
            .filter((entry) => entry.isIntersecting)
            .sort(
              (a, b) =>
                Math.abs(a.boundingClientRect.top + a.boundingClientRect.height / 2 - innerHeight * 0.35) -
                Math.abs(b.boundingClientRect.top + b.boundingClientRect.height / 2 - innerHeight * 0.35),
            )[0];
          const index = visible?.target instanceof HTMLElement ? Number(visible.target.dataset.step) : -1;
          if (index >= 0 && index < steps.length) setActive(index);
        },
        { rootMargin: "-20% 0px -50% 0px", threshold: 0 },
      );
      tabs.current.forEach((tab) => {
        if (tab) observer?.observe(tab);
      });
    };
    observe();
    desktop.addEventListener("change", observe);
    return () => {
      observer?.disconnect();
      desktop.removeEventListener("change", observe);
    };
  }, []);
  return (
    <section aria-labelledby={`${id}-title`} className="mx-auto max-w-6xl px-6 pt-12 pb-24 sm:pt-20 sm:pb-36">
      <WaveRule className="mb-16 opacity-50" />
      <div className="grid items-start gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:gap-20">
        <div>
          <h2 id={`${id}-title`} className="max-w-sm font-serif text-4xl leading-tight tracking-tight sm:text-5xl">
            Make yourself
            <br />
            at home.
          </h2>
          <div role="tablist" aria-label="Explore Max" aria-orientation="vertical" className="mt-10 grid gap-2">
            {steps.map((step, index) => (
              <button
                key={step.title}
                ref={(node) => {
                  tabs.current[index] = node;
                }}
                type="button"
                data-step={index}
                id={`${id}-tab-${index}`}
                role="tab"
                aria-selected={active === index}
                aria-controls={`${id}-preview`}
                tabIndex={active === index ? 0 : -1}
                onClick={() => setActive(index)}
                onKeyDown={(event) => {
                  const next =
                    event.key === "ArrowDown"
                      ? (index + 1) % steps.length
                      : event.key === "ArrowUp"
                        ? (index + steps.length - 1) % steps.length
                        : event.key === "Home"
                          ? 0
                          : event.key === "End"
                            ? steps.length - 1
                            : null;
                  if (next !== null) {
                    event.preventDefault();
                    setActive(next);
                    tabs.current[next]?.focus();
                  }
                }}
                className={`flex w-full flex-col justify-center border-s-2 px-5 py-4 text-start outline-none focus-visible:ring-2 focus-visible:ring-current lg:min-h-[42svh] ${active === index ? "border-fg text-fg" : "text-fg-2 hover:border-line hover:text-fg border-transparent"}`}
              >
                <span className="block text-base font-medium sm:text-lg">{step.title}</span>
                <span className={`text-fg-2 mt-3 text-sm leading-7 ${active === index ? "block" : "hidden lg:block"}`}>{step.body}</span>
              </button>
            ))}
          </div>
        </div>
        <div
          role="tabpanel"
          id={`${id}-preview`}
          aria-labelledby={`${id}-tab-${active}`}
          tabIndex={0}
          className="border-line bg-canvas shadow-pop focus-visible:ring-fg overflow-hidden rounded-2xl border outline-none focus-visible:ring-2 lg:sticky lg:top-20"
        >
          <div className="border-line text-fg-2 flex items-center gap-2 border-b px-4 py-3 text-xs">
            <LogoMark className="size-4" />
            <span>Max</span>
            <span className="text-fg-2 ms-auto">Example workspace</span>
          </div>
          <div className="grid min-h-[410px] grid-cols-[100px_minmax(0,1fr)] sm:grid-cols-[140px_minmax(0,1fr)]">
            <div className="border-line bg-surface-2/40 text-fg-2 border-e px-3 py-6 text-xs">
              <p className="text-fg mb-5 flex items-center gap-1 font-medium">
                <Folder className="size-3" />
                My space
              </p>
              {["Notes", "Projects", "Reading list"].map((title) => (
                <div key={title} className={`mb-1 flex items-center gap-1.5 rounded-md py-2 ${title === "Projects" && active === 2 ? "bg-hover text-fg" : ""}`}>
                  <FileText className="size-3 shrink-0" />
                  <span className="min-w-0 break-words">{title}</span>
                </div>
              ))}
            </div>
            <div key={active} className="min-w-0 px-4 py-7 motion-safe:animate-[max-panel-arrive_180ms_ease-out] sm:px-7">
              {active === 0 && (
                <>
                  <BookOpen className="text-fg-2 mb-4 size-7" />
                  <h3 className="text-xl font-semibold tracking-tight">From Notion</h3>
                  <p className="text-fg-2 mt-2 text-xs leading-6">Your pages, with room to grow.</p>
                  <div className="mt-7 space-y-3">
                    {["A collection of ideas", "Project plan", "Books for a rainy day"].map((title) => (
                      <div key={title} className="border-line flex items-center gap-2 rounded-lg border px-3 py-3 text-xs">
                        <FileText className="text-fg-2 size-4 shrink-0" />
                        <span>{title}</span>
                      </div>
                    ))}
                  </div>
                  <p className="text-fg-2 mt-6 text-[11px]">Copies in Max. Originals in Notion.</p>
                </>
              )}
              {active === 1 && (
                <>
                  <div
                    aria-label="Sample membership card"
                    className="paper-grain border-line bg-overlay shadow-pop mx-auto max-w-[210px] rounded-xl border p-4"
                  >
                    <div className="mx-auto mb-5 h-36 rounded-t-[80px] rounded-b-lg" style={{ backgroundColor: palettes[palette] }} />
                    <p className="text-base font-semibold">Your name</p>
                    <p className="text-fg-2 mt-1 text-xs">Curious explorer</p>
                    <p className="text-fg-2 mt-7 text-[9px] font-medium tracking-widest">MAX · PERSONAL</p>
                  </div>
                  <div className="mt-5 flex justify-center gap-3" role="group" aria-label="Preview card colors">
                    {paletteOptions.map((color) => (
                      <button
                        key={color}
                        type="button"
                        aria-label={`Preview ${color} card`}
                        aria-pressed={palette === color}
                        onClick={() => setPalette(color)}
                        style={{ backgroundColor: palettes[color] }}
                        className={`border-canvas focus-visible:outline-fg size-6 rounded-full border-2 outline-offset-2 focus-visible:outline-2 ${palette === color ? "outline-fg outline outline-1" : ""}`}
                      />
                    ))}
                  </div>
                </>
              )}
              {active === 2 && (
                <>
                  <h3 className="text-xl font-semibold tracking-tight">A small project</h3>
                  <div className="border-line mt-5 mb-6 flex gap-3 border-b text-xs" role="group" aria-label="Preview database layout">
                    <button
                      type="button"
                      aria-pressed={view === "table"}
                      onClick={() => setView("table")}
                      className={`flex items-center gap-1.5 border-b-2 py-2 ${view === "table" ? "border-fg" : "text-fg-2 border-transparent"}`}
                    >
                      <Table2 className="size-3" />
                      Table
                    </button>
                    <button
                      type="button"
                      aria-pressed={view === "board"}
                      onClick={() => setView("board")}
                      className={`flex items-center gap-1.5 border-b-2 py-2 ${view === "board" ? "border-fg" : "text-fg-2 border-transparent"}`}
                    >
                      <LayoutGrid className="size-3" />
                      Board
                    </button>
                  </div>
                  {view === "table" ? (
                    <div className="divide-line divide-y" aria-label="Sample project table">
                      {sampleRows.map((row) => (
                        <div key={row.title} className="grid gap-1 py-3 text-xs">
                          <span>{row.title}</span>
                          <span className="text-fg-2 text-[10px]">{row.status}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="grid gap-3 sm:grid-cols-2" aria-label="Sample project board">
                      {["To do", "In progress"].map((status) => (
                        <div key={status} className="bg-surface-2/50 rounded-lg p-2 text-[10px]">
                          <p className="text-fg-2 mb-3 flex items-center gap-1">
                            {status}
                            <ChevronDown className="size-3" />
                          </p>
                          {sampleRows
                            .filter((row) => row.status === status)
                            .map((row) => (
                              <div key={row.title} className="border-line bg-overlay mb-2 rounded-md border p-2 leading-5">
                                {row.title}
                              </div>
                            ))}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
