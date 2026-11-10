# Landing assets and motion

The landing uses real Max screenshots, captured from a disposable local workspace with sample notes. No private cloud workspace content is included. Each screenshot is 1280 ? 800, encoded as WebP, with light and dark variants chosen by the system theme. Only the selected feature image is mounted, and images load lazily below the hero.

## Refresh screenshots

Use a fresh data directory so captures contain only the seeded notes:

```powershell
pnpm build
$env:MAX_LOCAL_MODE = "true"
$env:MAX_DATA_DIR = ".e2e-data/marketing-capture-fresh"
pnpm start --port 3336
```

In a second terminal:

```powershell
node scripts/capture-marketing.mjs
```

The script refuses remote hosts, seeds sample notes and links, configures real graph preferences, and captures the editor, graph, membership card and sidebar. It writes `public/screenshots/*-{light,dark}.webp`. Never point it at an existing personal workspace server.

## Typography and interaction

Arc's current hero uses the commercially licensed Exposure typeface. Max uses the approved free Fraunces alternative, with similar headline proportions and spacing. It does not redistribute Arc's fonts or logos.

The Max logo tracks angular edge gestures and center pulls. Recent pointer samples determine the release; animation coasts to full turns, springs position and scale home, and sleeps at rest. Cancellation, pointer capture loss, page visibility, keyboard controls, and reduced motion are covered by focused tests.
