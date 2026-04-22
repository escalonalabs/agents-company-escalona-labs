# Agents Company by Escalona Labs

Agents Company is a clean-room rebuild for a GitHub-first company-of-agents platform.

## What this repository contains today

- A governance-first repository scaffold
- The product roadmap and delivery operating model
- Initial architecture decisions
- GitHub templates, ownership rules, and CI guardrails

## Core principles

- GitHub is the primary system for project progress, backlog, and human coordination
- The execution kernel is deterministic and internally ledgered
- No external product code is copied into this repository
- Every implementation slice must be traceable to an issue and Definition of Done

## Initial repository layout

- `docs/roadmap/` for delivery plans
- `docs/adr/` for architectural decisions
- `docs/backlog/` for backlog mirrors and operating system notes
- `docs/brand/` for naming and visual guidance
- `docs/operations/` for contributor and delivery rules
- `.github/` for templates, ownership, and CI guardrails

## Validation

Run the repository guardrails locally:

```bash
pnpm check:repo
```

## Security

See [SECURITY.md](SECURITY.md) for reporting guidance.

## License

This repository is public source-available code under the `Escalona Labs Public Source License 1.0`.

- Commercial use is prohibited without prior written permission from Escalona Labs
- Repository visibility does not grant product, trademark, or hosting rights
- See [LICENSE](LICENSE) and [docs/operations/licensing-and-commercial-use.md](docs/operations/licensing-and-commercial-use.md)
