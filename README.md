# Agents Company by Escalona Labs

Agents Company is a clean-room rebuild for a GitHub-first company-of-agents platform.

## What this repository contains today

- A real pnpm monorepo for the product runtime, control plane, and operator UI
- The product roadmap and delivery operating model
- Architecture decisions and runtime contracts
- GitHub templates, ownership rules, and CI guardrails

## Core principles

- GitHub is the primary system for project progress, backlog, and human coordination
- The execution kernel is deterministic and internally ledgered
- No external product code is copied into this repository
- Every implementation slice must be traceable to an issue and Definition of Done

## Initial repository layout

- `docs/roadmap/` for delivery plans
- `docs/adr/` for architectural decisions
- `docs/alpha-readiness/` for launch gates, runbooks, and replay readiness
- `docs/backlog/` for backlog mirrors and operating system notes
- `docs/brand/` for naming and visual guidance
- `docs/operations/` for contributor and delivery rules
- `apps/control-web/` for the operator web UI
- `packages/` for shared runtime, domain, GitHub, memory, and UI packages
- `server/control-plane/` and `server/github-app/` for backend surfaces
- `.github/` for templates, ownership, and CI guardrails

## Quick Start

1. Install dependencies:

```bash
pnpm install
```

2. Copy the environment template:

```bash
cp .env.example .env.local
```

3. Boot local dependencies:

```bash
pnpm dev:stack
```

4. Run database setup:

```bash
pnpm db:migrate
pnpm db:seed
```

5. Start the app and backend services:

```bash
pnpm dev
```

## Validation

Run the repository guardrails locally:

```bash
pnpm check:repo
pnpm check:replay
pnpm ci
```

## Security

See [SECURITY.md](SECURITY.md) for reporting guidance.

## License

This repository is public source-available code under the `Escalona Labs Public Source License 1.0`.

- Commercial use is prohibited without prior written permission from Escalona Labs
- Repository visibility does not grant product, trademark, or hosting rights
- See [LICENSE](LICENSE) and [docs/operations/licensing-and-commercial-use.md](docs/operations/licensing-and-commercial-use.md)
