"use client";

import { useEffect, useId, useRef, useState } from "react";

const features = [
  { id: "editor", title: "Write freely.", body: "A page for whatever comes next.", alt: "Max's block editor and sidebar, showing a design journal with headings, checklists and linked notes" },
  { id: "graph", title: "Connect the dots.", body: "See the threads between your ideas.", alt: "Max's graph view showing connected pages from a sample personal workspace" },
  { id: "card", title: "Make it yours.", body: "A little card. Entirely you.", alt: "Max's membership card screen with a personalized card, Change control and download action" },
  { id: "sidebar", title: "Keep it close.", body: "Your pages, right where you left them.", alt: "Max's sidebar with a reading shelf and the workspace's pages" },
];

/** Real app captures from disposable sample notes, not an imitation of the product. */
export default function Walkthrough() {
  const id = useId();
  const [active, setActive] = useState(0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const manual = useRef(false);
  useEffect(() => {
    const desktop = matchMedia("(min-width: 1024px)");
    let frame = 0;
    const update = () => {
      frame = 0;
      if (!desktop.matches || manual.current) return;
      let closest = 0;
      let distance = Infinity;
      tabs.current.forEach((tab, index) => {
        if (!tab) return;
        const box = tab.getBoundingClientRect();
        const next = Math.abs(box.top + box.height / 2 - innerHeight * .48);
        if (next < distance) { closest = index; distance = next; }
      });
      setActive(closest);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    const resume = () => { manual.current = false; schedule(); };
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    window.addEventListener("wheel", resume, { passive: true });
    window.addEventListener("touchmove", resume, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("wheel", resume);
      window.removeEventListener("touchmove", resume);
    };
  }, []);
  const feature = features[active];
  return (
    <section className="landing-showcase" aria-labelledby={`${id}-title`}>
      <div className="showcase-grid">
        <div className="showcase-copy">
          <h2 id={`${id}-title`} className="showcase-title">Made for<br />your mind.</h2>
          <div className="showcase-tabs" role="tablist" aria-label="Explore Max" aria-orientation="vertical">
            {features.map((item, index) => (
              <button key={item.id} ref={(node) => { tabs.current[index] = node; }} type="button" role="tab"
                id={`${id}-tab-${index}`} aria-selected={active === index} aria-controls={`${id}-preview`} tabIndex={active === index ? 0 : -1}
                onClick={() => { manual.current = true; setActive(index); }}
                onKeyDown={(event) => {
                  const next = event.key === "ArrowDown" ? (index + 1) % features.length : event.key === "ArrowUp" ? (index + features.length - 1) % features.length : event.key === "Home" ? 0 : event.key === "End" ? features.length - 1 : null;
                  if (next !== null) { event.preventDefault(); manual.current = true; setActive(next); tabs.current[next]?.focus(); }
                }}>
                <span className="showcase-feature-title">{item.title}</span>
                <span className="showcase-feature-body">{item.body}</span>
              </button>
            ))}
          </div>
        </div>
        <figure className="product-viewer" role="tabpanel" id={`${id}-preview`} aria-labelledby={`${id}-tab-${active}`} tabIndex={0} data-feature={feature.id}>
          <picture key={feature.id}>
            <source media="(prefers-color-scheme: dark)" srcSet={`/screenshots/${feature.id}-dark.webp`} />
            <img className="product-shot" src={`/screenshots/${feature.id}-light.webp`} width="1280" height="800" alt={feature.alt} loading="lazy" decoding="async" />
          </picture>
        </figure>
      </div>
    </section>
  );
}
