import { ImageResponse } from "next/og";
import { publicProfile, sharedPreview } from "@/lib/server/invites";
import { cardPalette } from "@/lib/domain/profileCard";
import { MARK_PATH } from "@/lib/brand";

/**
 * Link-preview images. `?u=<username>`: "Omar invited you to Max", with their card's colors.
 * `?t=<link token>&p=<page id>`: the shared page's icon and title and who shared it.
 * Anything unknown gets a plain Max image; nothing private is ever drawn.
 */
export const dynamic = "force-dynamic";

const SIZE = { width: 1200, height: 630 };
const PAPER = "#f6f3ec";
const INK = "#22201c";

function Mark({ size = 34, color = INK }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100">
      <path d={MARK_PATH} fill={color} />
    </svg>
  );
}

function Frame({ children, accent }: { children: React.ReactNode; accent: [string, string] }) {
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", background: PAPER, position: "relative", fontFamily: "sans-serif", color: INK }}>
      <div style={{ position: "absolute", right: -160, top: -160, width: 560, height: 560, borderRadius: 999, background: accent[0], opacity: 0.35, display: "flex" }} />
      <div style={{ position: "absolute", right: 120, bottom: -220, width: 460, height: 460, borderRadius: 999, background: accent[1], opacity: 0.3, display: "flex" }} />
      <div style={{ position: "absolute", left: 72, top: 64, display: "flex", alignItems: "center", gap: 14, fontSize: 30, fontWeight: 700 }}>
        <Mark />
        Max
      </div>
      {children}
    </div>
  );
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const username = url.searchParams.get("u");
  const token = url.searchParams.get("t");
  const pageId = url.searchParams.get("p");

  if (username) {
    const profile = await publicProfile(username.slice(0, 40));
    if (profile) {
      const p = cardPalette(profile.card.theme);
      return new ImageResponse(
        (
          <Frame accent={[p.first, p.second]}>
            <div style={{ position: "absolute", left: 72, top: 170, width: 300, height: 380, borderRadius: 26, background: "#fffdf6", boxShadow: "0 30px 60px rgba(0,0,0,.18)", display: "flex", flexDirection: "column", padding: 18, transform: "rotate(-4deg)" }}>
              <div style={{ display: "flex", height: 230, borderRadius: 14, background: `linear-gradient(135deg, ${p.glow}, ${p.first} 45%, ${p.second})` }} />
              <div style={{ display: "flex", marginTop: 18, fontSize: 13, letterSpacing: 2, fontWeight: 700, color: p.ink }}>{`MAX MEMBER  NO. ${String(profile.memberNumber ?? 0).padStart(6, "0")}`}</div>
              <div style={{ display: "flex", marginTop: 10, fontSize: 30, fontWeight: 700, color: p.ink }}>{profile.name.slice(0, 22)}</div>
            </div>
            <div style={{ position: "absolute", left: 470, top: 210, right: 72, display: "flex", flexDirection: "column" }}>
              <div style={{ display: "flex", fontSize: 76, fontWeight: 700, lineHeight: 1.05, letterSpacing: -2 }}>{`${profile.name.split(" ")[0]} invited you to Max`}</div>
              <div style={{ display: "flex", marginTop: 26, fontSize: 30, color: "#5b574f" }}>A card and a note are waiting for you.</div>
            </div>
          </Frame>
        ),
        SIZE,
      );
    }
  }

  if (token && pageId) {
    const page = await sharedPreview(token.slice(0, 80), pageId.slice(0, 80));
    if (page) {
      const what = page.public ? "Published on Max" : page.teamspace ? "Teamspace invite" : "Shared with you";
      return new ImageResponse(
        (
          <Frame accent={["#9fb9ff", "#ffc7a8"]}>
            <div style={{ position: "absolute", left: 72, top: 170, right: 72, display: "flex", flexDirection: "column" }}>
              {/* A drawn page, not the page's emoji: emoji would be fetched from the internet at render time. */}
              <svg width="96" height="116" viewBox="0 0 96 116">
                <path d="M10 2h52l32 32v70a10 10 0 0 1-10 10H10A10 10 0 0 1 0 104V12A10 10 0 0 1 10 2z" fill="#ffffff" stroke="#22201c" strokeOpacity=".18" strokeWidth="3" />
                <path d="M62 2v24a8 8 0 0 0 8 8h24" fill="none" stroke="#22201c" strokeOpacity=".18" strokeWidth="3" />
                <path d="M20 58h56M20 74h56M20 90h36" stroke="#22201c" strokeOpacity=".35" strokeWidth="6" strokeLinecap="round" />
              </svg>
              <div style={{ display: "flex", marginTop: 30, fontSize: page.title.length > 40 ? 58 : 76, fontWeight: 700, lineHeight: 1.05, letterSpacing: -2, maxWidth: 1000 }}>{page.title.slice(0, 90)}</div>
              <div style={{ display: "flex", marginTop: 28, fontSize: 30, color: "#5b574f" }}>{page.from ? `${what} by ${page.from}` : what}</div>
            </div>
          </Frame>
        ),
        { ...SIZE, headers: { "Cache-Control": "public, max-age=300" } },
      );
    }
  }

  return new ImageResponse(
    (
      <Frame accent={["#ffd27d", "#ffa3b5"]}>
        <div style={{ position: "absolute", left: 72, top: 230, display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", fontSize: 96, fontWeight: 700, letterSpacing: -3 }}>Think together.</div>
          <div style={{ display: "flex", marginTop: 20, fontSize: 32, color: "#5b574f" }}>Your notes, pages and databases. Private by default.</div>
        </div>
      </Frame>
    ),
    SIZE,
  );
}
