# Security Policy

## Supported versions

Max is currently pre-alpha and has no released or supported production versions. This policy will be updated when the first release ships.

## Reporting a vulnerability

**Do not open a public GitHub issue for a security vulnerability.**

Please use GitHub's **Report a vulnerability** / private vulnerability reporting feature on this repository if enabled. If it is not enabled, contact the repository maintainer privately through their GitHub profile and request a secure reporting channel. Do not post exploit details or private user data publicly.

Include a concise description, affected commit/version, reproduction steps, potential impact and a safe proof of concept where possible. Do not test against accounts or data you do not own.

The maintainers will triage reports as capacity allows. No response or remediation SLA is promised at this pre-alpha stage.

## Security design requirements

- Clerk authentication does not replace Convex server-side authorization.
- Every query, mutation, asset operation and MCP tool must verify the authenticated user's ownership.
- Treat rich text, embeds, uploads and imported documents as untrusted input.
- Do not log note contents, session tokens or secrets.
- Support token revocation, least-privilege MCP grants, rate limiting and destructive-operation safeguards.
- Never commit real secrets. Use environment variables and sanitized examples.
