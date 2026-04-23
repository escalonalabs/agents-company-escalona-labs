# Agents Company by Escalona Labs

Agents Company is a company-of-agents platform.

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

3. Boot local dependencies. The local Postgres port is intentionally mapped to
   `55432` so it does not collide with other stacks already using `5432`:

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

## Local Self-Hosted Stack

The repository now includes a minimal self-hosted packaging path that keeps the
runtime code unchanged and runs the product surfaces in containers:

- `control-plane`
- `github-app`
- `control-web`
- local dependencies for `postgres`, `minio`, and `mailpit`

Start the stack:

```bash
docker compose up --build -d
```

Open:

- `http://localhost:8080` for the operator UI
- `http://localhost:3000/health` for the control-plane health endpoint
- `http://localhost:3001/health` for the GitHub App health endpoint
- `http://localhost:8025` for Mailpit
- `http://localhost:9001` for the MinIO console

For the first bootstrapped operator and first company flow, plus the required
environment variables and Helm foundation, see
[docs/operations/self-hosted.md](docs/operations/self-hosted.md).

## Hosted AWS Foundation

The repository now also contains the `M15` hosted infrastructure scaffold:

- versioned Terraform under [`infra/aws/`](infra/aws)
- hardened Helm values for staging and production
- Dockerized validation scripts for Helm and Terraform

Primary references:

- [docs/operations/hosted-aws.md](docs/operations/hosted-aws.md)
- [infra/aws/README.md](infra/aws/README.md)

## GA Operations

The repository now includes the explicit `M17` operating discipline for general
availability:

- [docs/operations/ga-runbook.md](docs/operations/ga-runbook.md)
- [docs/operations/release-train.md](docs/operations/release-train.md)
- [docs/operations/support-and-oncall.md](docs/operations/support-and-oncall.md)

## M18 Launch Evidence

The repository now includes the final evidence and activation pack used to ship
the first production candidate without relying on chat memory:

- [docs/releases/v0.1.0.md](docs/releases/v0.1.0.md)
- [docs/operations/hosted-rotation-and-drills.md](docs/operations/hosted-rotation-and-drills.md)
- [docs/operations/monitoring-dashboards.md](docs/operations/monitoring-dashboards.md)
- [ops/monitoring/grafana/agents-company-overview.json](ops/monitoring/grafana/agents-company-overview.json)

## Validation

Run the repository guardrails locally:

```bash
pnpm check:repo
pnpm check:replay
pnpm run ci
pnpm ops:validate:m15
pnpm release:evidence -- --version v0.1.0 --release-branch release/v0.1.0
```

## Security

See [SECURITY.md](SECURITY.md) for reporting guidance.

## License

This repository is public source-available code under the `Escalona Labs Public Source License 1.0`.

- Commercial use is prohibited without prior written permission from Escalona Labs
- Repository visibility does not grant product, trademark, or hosting rights
- See [LICENSE](LICENSE) and [docs/operations/licensing-and-commercial-use.md](docs/operations/licensing-and-commercial-use.md)
