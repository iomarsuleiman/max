"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { cn } from "@/components/ui";

type Heading = { element: HTMLElement; label: string; level: number };

/** Reads the rendered headings without subscribing the document editor to scroll state. */
export function DocumentOutline({ contentRef }: { contentRef: RefObject<HTMLDivElement | null> }) {
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [active, setActive] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const [rail, setRail] = useState<{ top: number; end: number; height: number } | null>(null);
  const headingsRef = useRef<Heading[]>([]);

  useEffect(() => {
    const content = contentRef.current;
    const scroll = content?.closest("#page-scroll");
    if (!content || !scroll) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let frame = 0;
    const updateActive = () => {
      frame = 0;
      const bounds = scroll.getBoundingClientRect();
      // Stay beside the document, never over its cover, and clear the scrollbar.
      const railTop = Math.max(bounds.top + bounds.height / 3, content.getBoundingClientRect().top + 12);
      const nextRail = {
        top: railTop,
        end: (document.documentElement.dir === "rtl" ? bounds.left : innerWidth - bounds.right) + 24,
        height: Math.max(0, Math.min(bounds.height / 2, bounds.bottom - railTop - 20)),
      };
      setRail((previous) => previous?.top === nextRail.top && previous.end === nextRail.end && previous.height === nextRail.height ? previous : nextRail);
      const top = bounds.top + 100;
      let current: HTMLElement | null = headingsRef.current[0]?.element ?? null;
      for (const heading of headingsRef.current) {
        if (heading.element.getBoundingClientRect().top > top) break;
        current = heading.element;
      }
      if (scroll.scrollHeight > scroll.clientHeight && scroll.scrollTop + scroll.clientHeight >= scroll.scrollHeight - 2) {
        current = headingsRef.current.at(-1)?.element ?? null;
      }
      setActive(current);
    };
    const collect = () => {
      const next = Array.from(
        content.querySelectorAll<HTMLElement>(".bn-editor h1, .bn-editor h2, .bn-editor h3, .bn-editor h4, .bn-editor h5, .bn-editor h6"),
      ).map((element) => ({ element, label: element.textContent?.trim() || "Untitled heading", level: Number(element.tagName.slice(1)) }));
      const previous = headingsRef.current;
      if (
        next.length !== previous.length ||
        next.some((h, i) => h.element !== previous[i]?.element || h.label !== previous[i]?.label || h.level !== previous[i]?.level)
      ) {
        headingsRef.current = next;
        setHeadings(next);
      }
      updateActive();
    };
    const scheduleCollect = () => {
      clearTimeout(timer);
      timer = setTimeout(collect, 150);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(updateActive);
    };
    const observer = new MutationObserver(scheduleCollect);
    const resizeObserver = new ResizeObserver(onScroll);
    observer.observe(content, { childList: true, subtree: true, characterData: true });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["dir"] });
    resizeObserver.observe(scroll);
    resizeObserver.observe(content);
    collect();
    scroll.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      observer.disconnect();
      resizeObserver.disconnect();
      scroll.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      clearTimeout(timer);
      cancelAnimationFrame(frame);
    };
  }, [contentRef]);

  if (!headings.length || !rail || rail.height < 44) return null;
  const jump = (heading: Heading) => {
    const scroll = contentRef.current?.closest("#page-scroll");
    if (!scroll) return;
    scroll.scrollTo({
      top: scroll.scrollTop + heading.element.getBoundingClientRect().top - scroll.getBoundingClientRect().top - 36,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
    });
    heading.element.tabIndex = -1;
    heading.element.focus({ preventScroll: true });
    setActive(heading.element);
  };
  return (
    <nav
      aria-label="Page outline"
      className="fixed z-20 max-xl:hidden"
      style={{ top: rail.top, insetInlineEnd: rail.end }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          setOpen(false);
          event.stopPropagation();
        }
      }}
    >
      <button
        type="button"
        aria-label="Show page outline"
        aria-expanded={open}
        aria-controls="page-outline-links"
        onClick={() => setOpen((value) => !value)}
        onFocus={() => setOpen(true)}
        className="focus-visible:outline-accent flex w-12 flex-col items-end gap-3 overflow-hidden rounded-md p-3"
        style={{ maxHeight: rail.height }}
      >
        {headings.map((heading, index) => (
          <span
            key={index}
            className={cn("h-0.5 shrink-0 rounded-full", heading.element === active ? "bg-fg" : "bg-fg-3/50")}
            style={{ width: heading.level === 1 ? 20 : heading.level === 2 ? 16 : 12 }}
          />
        ))}
      </button>
      {open && (
        <div
          id="page-outline-links"
          className="border-line bg-overlay shadow-pop absolute end-full top-0 max-h-[50vh] w-72 overflow-y-auto rounded-xl border p-2"
          style={{ maxHeight: rail.height }}
          onBlur={(event) => {
            if (!event.currentTarget.parentElement?.contains(event.relatedTarget)) setOpen(false);
          }}
        >
          <p className="text-fg-3 px-2 py-1.5 text-xs font-medium">On this page</p>
          {headings.map((heading, index) => (
            <button
              key={index}
              type="button"
              onClick={() => jump(heading)}
              aria-current={heading.element === active ? "location" : undefined}
              className={cn(
                "hover:bg-hover block w-full rounded-md py-1.5 pe-2 text-start text-[13px] leading-5",
                heading.element === active ? "bg-hover text-accent-text" : "text-fg-2",
              )}
              style={{ paddingInlineStart: 8 + (heading.level - 1) * 12 }}
            >
              {heading.label}
            </button>
          ))}
        </div>
      )}
    </nav>
  );
}
