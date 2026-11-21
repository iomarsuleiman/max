"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ChevronRight, FileText, LayoutTemplate, Search, Table2, Waypoints } from "@/components/icons";
import { LogoMark } from "@/components/brand/Logo";
import { CLOUD } from "@/lib/config";

const features = [
  { id: "write", title: "Write freely", body: "A page for whatever comes next. Headings, checklists, tables, code and images, all with the same few keys.", label: "Your pages" },
  { id: "connect", title: "Connect the dots", body: "Link pages as you write. The graph view shows the threads between your ideas.", label: "Graph view" },
  { id: "organize", title: "Organize anything", body: "Turn a list into a database, with tables, boards and views for every way you look at it.", label: "Databases" },
  { id: "together", title: "Work together", body: "Share a page or a whole teamspace. Type at the same time and see each other's cursors.", label: "Teamspaces" },
  { id: "close", title: "Keep it close", body: "Favorites and recent pages sit right where you left them, a click away.", label: "Favorites" },
] as const;

type FeatureId = (typeof features)[number]["id"];

/**
 * "Made for your mind": a feature list on the left whose current item lights up as you scroll,
 * beside a drawn Max window with a label pointing at the part of the app each feature is about.
 */
export function MadeForYourMind() {
  const [active, setActive] = useState<FeatureId>("write");
  const items = useRef<(HTMLLIElement | null)[]>([]);
  const manual = useRef(0);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      if (performance.now() - manual.current < 900) return;
      let best: FeatureId = features[0].id;
      let distance = Infinity;
      items.current.forEach((el, i) => {
        if (!el) return;
        const box = el.getBoundingClientRect();
        const d = Math.abs(box.top + box.height / 2 - innerHeight * 0.45);
        if (d < distance) {
          distance = d;
          best = features[i].id;
        }
      });
      setActive(best);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, []);

  const label = features.find((f) => f.id === active)!.label;
  return (
    <section className="landing-showcase mind" aria-labelledby="mind-title">
      <div className="mind-grid">
        <div className="mind-copy">
          <p className="mind-eyebrow">What Max does</p>
          <h2 id="mind-title" className="showcase-title">
            Made for
            <br />
            your mind.
          </h2>
          <p className="mind-intro">A calm place for everything you think about. Max keeps your pages, databases and ideas together, then gets out of the way.</p>
          <ul className="mind-list">
            {features.map((f, i) => (
              <li key={f.id} ref={(el) => { items.current[i] = el; }}>
                <button
                  type="button"
                  className="mind-item"
                  aria-current={active === f.id ? "true" : undefined}
                  onClick={() => {
                    manual.current = performance.now();
                    setActive(f.id);
                  }}
                >
                  <span className="mind-item-title">{f.title}</span>
                  <span className="mind-item-body">{f.body}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="mind-actions">
            <Link href={CLOUD ? "/sign-up" : "/home"} className="mind-button joy-press">
              <LogoMark className="size-5" /> Open Max
            </Link>
            <Link href="/privacy" className="mind-more">
              How Max keeps it private <ChevronRight className="size-4" aria-hidden />
            </Link>
          </div>
        </div>
        <div className="mind-stage" aria-hidden>
          <MaxWindow active={active} label={label} />
        </div>
      </div>
    </section>
  );
}

function MaxWindow({ active, label }: { active: FeatureId; label: string }) {
  const on = (id: FeatureId) => (active === id ? " is-on" : "");
  return (
    <div className="mind-window">
      <aside className="mind-sidebar">
        <div className="mind-top">
          <span className="mind-dots"><i /><i /><i /></span>
          <span className="mind-space"><LogoMark className="size-3.5" /> Max</span>
        </div>
        <div className="mind-nav">
          <p className="mind-navrow"><Search className="size-3.5" /> Search</p>
          <p className="mind-navrow"><LayoutTemplate className="size-3.5" /> Templates</p>
          <p className={`mind-navrow${on("connect")}`}><Waypoints className="size-3.5" /> Graph view</p>
        </div>
        <div className={`mind-group${on("close")}`}>
          <p className="mind-group-title">Favorites</p>
          <p className="mind-page">🧳 Lisbon trip</p>
          <p className="mind-page">📓 Journal</p>
        </div>
        <div className={`mind-group${on("together")}`}>
          <p className="mind-group-title">Teamspaces</p>
          <p className="mind-page"><span className="mind-team">🏡</span> Family <span className="mind-faces"><i /><i /><i /></span></p>
          <p className="mind-page"><span className="mind-team">🚀</span> Side project <span className="mind-faces"><i /><i /></span></p>
        </div>
        <div className="mind-group">
          <p className="mind-group-title">Private</p>
          <p className="mind-page">🧳 Lisbon trip</p>
          <p className={`mind-page${on("organize")}`}><Table2 className="mind-db size-3.5" /> Reading list</p>
          <p className="mind-page">🌱 Garden</p>
          <p className="mind-page">🍳 Recipes</p>
        </div>
      </aside>
      <div className={`mind-page-view${on("write")}`}>
        <div className="mind-crumbs"><FileText className="size-3.5" /> Lisbon trip</div>
        <div className="mind-doc">
          <span className="mind-doc-icon">🧳</span>
          <p className="mind-doc-title">Lisbon trip</p>
          <p className="mind-doc-text">Four days in May. Slow mornings, long lunches, one good map.</p>
          <p className="mind-doc-h">Before we go</p>
          <p className="mind-doc-check is-done">Book the flat in Alfama</p>
          <p className="mind-doc-check">Download offline maps</p>
          <p className="mind-doc-h">Day one</p>
          <p className="mind-doc-text">Tram 28 up to the castle, then pastéis de nata in <span className="mind-link">Belém</span>.</p>
        </div>
      </div>
      <span className={`mind-callout mind-callout-${active}`}>
        <span className="mind-callout-line" />
        <span className="mind-callout-pill">{label}</span>
      </span>
    </div>
  );
}
