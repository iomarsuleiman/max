# Contributing to Max

Thanks for helping build Max.

## Getting started

```bash
pnpm install
pnpm dev          # local mode, no accounts needed
pnpm check        # lint + typecheck + unit tests
pnpm e2e          # Playwright journeys against a production build
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) before changing data or operations.

## Rules of the road

1. **One operation layer.** Add or change behaviour in `lib/domain/ops`. The UI and MCP both call it; never add a UI-only or MCP-only path for data. Run `pnpm mcp:docs` when operations change.
2. **Ownership first.** Every handler must load data through `requirePage`/owner-scoped queries. Add a cross-account test for new operations.
3. **Truthful states.** Don't show success before the server confirms. Every new control needs loading, empty, error and disabled states.
4. **Tests.** Behaviour changes come with unit tests; user-visible flows with a Playwright journey where practical.
5. **Scope.** Max is a private, single-owner workspace. Collaboration and sharing are out of scope.
6. Keep secrets, real notes and production data out of commits and fixtures.

## Pull requests

Use the PR template, keep changes focused, include screenshots for UI changes and only tick checks you ran.

## License

Max is licensed under [AGPL-3.0-or-later](LICENSE). By contributing, you agree your contribution is provided under that license.
