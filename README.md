# Max

**Max** is an open-source, personal notes and knowledge workspace inspired by the simplicity of Notion. Sign in, organize nested pages, write rich documents, manage personal databases, and access the same capabilities through an MCP client.

> **Status: planning / pre-alpha.** The application is not implemented yet. This repository currently contains project and community scaffolding, not a working editor.

## Planned features

- Private accounts and sign-in with Clerk
- Notes, nested pages, search, favorites and trash
- Block-based rich-text editing using BlockNote
- Personal databases and saved views
- Reliable autosave, recovery, import and export
- Remote Model Context Protocol (MCP) interface with parity for all supported UI operations
- Light/dark themes, responsive design and Arabic/RTL support

**Not planned:** team workspaces, real-time collaboration, shared cursors or invitations.

## Planned stack

Next.js, React, TypeScript, Convex, Clerk, BlockNote, Tailwind CSS, shadcn/ui, and a remote MCP server using shared application services. These are architecture decisions, not installed dependencies yet.

## Getting started

The app has not been scaffolded, so there are no installation or run commands yet. Once implementation begins, this section will document prerequisites, environment variables, local development, tests and deployment. Do not commit credentials.

## Project documentation

- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
- [Code of conduct](CODE_OF_CONDUCT.md)
- [Support](SUPPORT.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Roadmap](docs/ROADMAP.md)
- [Brand assets](assets/README.md)

## Contributing

Issues and pull requests are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a PR. The project is at an early stage; proposed features should be discussed before large implementations.

## License

MIT — see [LICENSE](LICENSE). Third-party libraries, fonts, and any later-added artwork retain their respective licenses. The Max logo will be supplied separately; its reuse terms must be confirmed before publishing.

## Disclaimer

Max is independent of Notion and is not affiliated with or endorsed by Notion.
