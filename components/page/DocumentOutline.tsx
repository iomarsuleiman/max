"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { cn } from "@/components/ui";

type Heading = { element: HTMLElement; label: string; level: number };

/** Reads the rendered headings without subscribing the document editor to scroll state. */
export function DocumentOutline({ contentRef }: { contentRef: RefObject<HTMLDivElement | null> }) {
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [active, setActive] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const headingsRef = useRef<Heading[]>([]);

  useEffect(() => {
    const content = contentRef.current;
    const scroll = content?.closest("#page-scroll");
    if (!content || !scroll) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let frame = 0;
    const updateActive = () => {
      frame = 0;
      const top = scroll.getBoundingClientRect().top + 100;
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
    observer.observe(content, { childList: true, subtree: true, characterData: true });
    collect();
    scroll.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      observer.disconnect();
      scroll.removeEventListener("scroll", onScroll);
      clearTimeout(timer);
      cancelAnimationFrame(frame);
    };
  }, [contentRef]);

  if (!headings.length) return null;
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
      className="fixed end-3 top-1/3 z-20 max-xl:hidden"
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
        className="focus-visible:outline-accent flex max-h-[50vh] w-10 flex-col items-end gap-3 overflow-hidden rounded-md p-3"
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
