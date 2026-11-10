"use client";

/* eslint-disable @next/next/no-html-link-for-pages -- Root-layout recovery requires full document navigation without the failed router tree. */

/** Root-layout failures cannot depend on Max's providers, fonts or global stylesheet. */
export default function GlobalError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <html lang="en">
      <head>
        <title>Could not open Max</title>
        <style>{`:root{color-scheme:light dark;--recovery-bg:#f8f7f4;--recovery-fg:#292c29;--recovery-muted:#60635f;--recovery-link:#345f92}@media(prefers-color-scheme:dark){:root{--recovery-bg:#1b1c20;--recovery-fg:#ecece9;--recovery-muted:#b4b7bd;--recovery-link:#a6c9f2}}`}</style>
      </head>
      <body style={{ margin: 0, background: "var(--recovery-bg)", color: "var(--recovery-fg)", fontFamily: "system-ui, sans-serif" }}>
        <main style={{ maxWidth: 480, margin: "0 auto", padding: "min(20vh, 120px) 24px 64px" }}>
          <a href="/" style={{ color: "inherit", fontSize: 20, fontWeight: 650, textDecoration: "none" }}>
            Max
          </a>
          <p style={{ marginTop: 48, color: "var(--recovery-muted)", fontSize: 13 }}>A little interruption</p>
          <h1 style={{ fontSize: 32, lineHeight: 1.15 }}>We could not open Max.</h1>
          <p style={{ color: "var(--recovery-muted)", lineHeight: 1.75 }}>
            Check your connection, then try again. If the problem continues, reopen Max in a moment.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center", marginTop: 28 }}>
            <button
              type="button"
              onClick={retry}
              style={{ border: 0, borderRadius: 8, background: "#3c6ea8", color: "#fff", padding: "12px 18px", font: "inherit", cursor: "pointer" }}
            >
              Try again
            </button>
            <a href="/home" style={{ color: "var(--recovery-link)", padding: "12px 0" }}>
              Go to my pages
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}
