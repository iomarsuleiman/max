# Connections and personal cards

Design source: https://www.figma.com/design/6KtVd71Naz7oFt4fJO73HA

The editable frames cover Connections, authorized source selection, import review, background progress, reconciliation report, connection success/failure, missing-page and runtime recovery, card onboarding and profile preview. Existing Max tokens, Inter typography, matte surfaces and quiet blue actions remain the visual foundation.

Notion lives in Settings → Connections. The import flow says “Import a copy”, shows only shared sources, asks for a Max destination, discloses estimated scope and unsupported content, then shows persisted progress and an itemized report. Disconnect does not remove imported content. ZIP import remains available.

Connection and error screens provide one primary recovery action, a return path and specific fixed copy. Never display OAuth codes, tokens or arbitrary provider error descriptions. A localhost callback served by an assistant is outside Max's styling boundary.

The user later supplied Arc/Chaos membership-card references and asked to stop Figma work. Cards now use a portrait paper frame, a large arch/leaf/orbit artwork, name, subtitle, biography and an honest personal/private footer. Sunset joins ocean, sage, clay and lilac palettes. Preview and PNG export share one SVG renderer; MCP uses the same card model and exports PNG without publishing it.

The landing page uses Max's existing colors with open typography, an interactive butterfly with inertial drag rotation and a clear workspace action. Tabs, switches and buttons have short feedback transitions. Both OS and in-app reduced-motion preferences stop decorative movement. The optional Paper hop game appears in offline recovery; no game starts automatically or interrupts editing. The service worker caches only the two static offline assets, never workspace content or API responses.

The final Arc reference revision removes the landing topbar, feature grid, theme toggle and visible interaction instructions. Its foreground butterfly and neutral surfaces follow the system theme independently of stored workspace preferences. A single 32 × 32 PNG tile, 1,160 bytes, supplies static paper grain. It uses no filters, blending or animated noise. Static SVG wave rules and a restrained token-based heading gradient add detail to recovery cards. Public help pages retain a theme control; the landing does not.

Below the hero, a compact product walkthrough pairs selectable descriptions with HTML previews. On desktop the preview stays sticky inside its section while the text scrolls; IntersectionObserver updates the selected step without a continuous scroll listener. Mobile uses ordinary stacked tabs. Palette and table/board previews are local sample interactions, clearly labelled, with no backend requests, autoplay or video payload.
