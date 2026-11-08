# Setting up Max in production

Everything in the app is built and tested. These are the steps only the owner can do, because they need accounts, keys or DNS. Work through them in order; each says how to check it worked.

## Owner checklist

- [ ] **1. Convex project.** `npx convex dev` (log in, create a project named `max`). This writes `CONVEX_DEPLOYMENT` and `NEXT_PUBLIC_CONVEX_URL` to `.env.local` and pushes `convex/`. Then `npx convex deploy` for production.
- [ ] **2. Clerk application.** Create an app at clerk.com (email + Google/Apple as you like). Copy `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY`.
- [ ] **3. Connect Clerk to Convex.** In Clerk: *JWT templates → New → Convex* (name must be `convex`). Copy its *Issuer* URL and set it in the Convex dashboard as `CLERK_JWT_ISSUER_DOMAIN` (dev and prod deployments).
- [ ] **4. Server secret.** Generate one: `openssl rand -base64 48`. Set the same value as `MAX_SERVER_SECRET` in the Convex dashboard (both deployments) and in Vercel. The MCP endpoint uses it to call Convex for an already-authenticated account.
- [ ] **5. Vercel project.** Import `iomarsuleiman/max`. Set environment variables: `NEXT_PUBLIC_CONVEX_URL`, `CONVEX_DEPLOY_KEY` (from Convex, for builds), `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `MAX_SERVER_SECRET`, `NEXT_PUBLIC_APP_URL=https://max.chaos.fail`. Build command: `npx convex deploy --cmd 'pnpm build'`.
- [ ] **6. Domain.** Add `max.chaos.fail` in Vercel, then create the DNS record it shows (CNAME `max` → `cname.vercel-dns.com`) at the chaos.fail DNS provider. In Clerk, add the production domain and its DNS records.
- [ ] **7. Assistant sign-in (OAuth for ChatGPT/Claude).** In Clerk: *Configure → OAuth applications → enable Dynamic client registration*. Check `https://max.chaos.fail/.well-known/oauth-protected-resource/mcp` lists your Clerk domain under `authorization_servers`. Then add `https://max.chaos.fail/mcp` as a custom connector in ChatGPT and Claude.
- [ ] **8. Cover images.** On a machine with internet access: `pnpm covers:fetch`, review `public/covers/` and `lib/client/cover-manifest.json` (public-domain items from The Met and NASA, with credits), and commit them.
- [ ] **9. Repository settings.** Enable branch protection on `main` with the CI checks required, private vulnerability reporting, secret scanning and push protection.
- [ ] **10. Smoke test with two accounts.** Sign up as two different people. Each creates pages, a database and a token; confirm neither can see the other's pages, search results or `/p/<id>` links, and that MCP tools with one account's token only see that account.
- [ ] **11. Optional monitoring.** Errors and Web Vitals are logged as structured JSON (no note content). Connect Vercel log drains or Sentry if you want alerts.

## Environment variables

| Variable | Where | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_CONVEX_URL` | Vercel, `.env.local` | Convex deployment URL (cloud mode) |
| `CONVEX_DEPLOYMENT` | `.env.local` | Set by `npx convex dev` |
| `CONVEX_DEPLOY_KEY` | Vercel | Lets Vercel builds deploy Convex functions |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY` | Vercel, `.env.local` | Clerk (cloud mode) |
| `CLERK_JWT_ISSUER_DOMAIN` | Convex dashboard | Lets Convex verify Clerk sessions |
| `MAX_SERVER_SECRET` | Convex dashboard and Vercel | MCP → Convex calls (32+ characters, same value) |
| `NEXT_PUBLIC_APP_URL` | Vercel | Canonical URL, defaults to `https://max.chaos.fail` |
| `MAX_LOCAL_MODE` | Self-hosting | `true` allows local mode in a production build |
| `MAX_DATA_DIR` | Self-hosting | Where local mode stores data (default `.max-data`) |

Without the Clerk and Convex variables, `pnpm dev` runs in **local mode**: one private workspace stored as JSON under `.max-data/`, including uploaded files. A production build without them shows a "Max needs to be connected" page unless `MAX_LOCAL_MODE=true`.

## Backups and recovery

- Users can export everything (Settings → Data & export) as Markdown or a JSON backup, and re-import the JSON.
- Convex keeps point-in-time backups on paid plans; schedule exports from the Convex dashboard for extra safety.
- Local mode: back up the `.max-data/` folder.

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| "We couldn't confirm your session" | Clerk JWT template isn't named `convex`, or `CLERK_JWT_ISSUER_DOMAIN` is missing in Convex |
| MCP returns 401 with a valid token | `MAX_SERVER_SECRET` differs between Vercel and Convex |
| ChatGPT can't sign in | Dynamic client registration is off in Clerk |
| Uploads fail | Convex storage limits, or the file isn't PNG/JPEG/WebP/GIF/AVIF/SVG under 20 MB |
