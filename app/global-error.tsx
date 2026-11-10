"use client";

/* eslint-disable @next/next/no-html-link-for-pages -- Root-layout recovery requires full document navigation without the failed router tree. */

/** Root-layout failures cannot depend on Max's providers, fonts or global stylesheet. */
export default function GlobalError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <html lang="en">
      <head><title>Could not open Max</title></head>
      <body style={{ margin: 0, background: "#f8f7f4", color: "#292c29", fontFamily: "system-ui, sans-serif" }}>
        <main style={{ maxWidth: 480, margin: "0 auto", padding: "min(20vh, 120px) 24px 64px" }}>
          <a href="/" style={{ color: "inherit", fontSize: 20, fontWeight: 650, textDecoration: "none" }}>Max</a>
          <p style={{ marginTop: 48, color: "#60635f", fontSize: 13 }}>A little interruption</p>
          <h1 style={{ fontSize: 32, lineHeight: 1.15 }}>We could not open Max.</h1>
          <p style={{ color: "#60635f", lineHeight: 1.75 }}>Check your connection, then try again. If the problem continues, reopen Max in a moment.</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center", marginTop: 28 }}>
            <button type="button" onClick={retry} style={{ border: 0, borderRadius: 8, background: "#3c6ea8", color: "#fff", padding: "12px 18px", font: "inherit", cursor: "pointer" }}>Try again</button>
            <a href="/home" style={{ color: "#345f92", padding: "12px 0" }}>Go to my pages</a>
          </div>
        </main>
      </body>
    </html>
  );
}
