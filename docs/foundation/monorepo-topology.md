# Monorepo Topology And Bounded Contexts

## Goal

Define package and application seams once, early, so the platform can grow without repeatedly renaming the same boundary or mixing runtime concerns with UI and integration code.

## Top-level layout

```text
apps/
  control-web/
  docs-site/                  # later
packages/
  domain/
  kernel/
  orchestration/
  execution/
  memory/
  github/
  sdk/
  ui/
server/
  control-plane/
  github-app/
docs/
  adr/
  foundation/
  roadmap/
  brand/
  backlog/
  operations/
```

## Bounded contexts

### Domain

Owns canonical types and invariants for company, objective, work item, run, approval, artifact, and policy references.

Rules:

- no GitHub client logic
- no UI concerns
- no transport-specific behavior
- shared by kernel, server, and SDK surfaces

### Kernel

Owns state machine, event model, ledger semantics, replay, idempotency, and projections from runtime truth.

Rules:

- deterministic logic only
- no direct browser or shell execution
- no GitHub write side-effects inside reducers

### Orchestration

Owns objective compilation, planning, scheduling, leases, retries, concurrency caps, and escalation triggers.

Rules:

- consumes domain and kernel contracts
- cannot bypass approvals or execution packet freezing

### Execution

Owns tool contracts, executor boundaries, artifact capture, task-result validation, and capability policy enforcement.

Rules:

- effects are explicit and auditable
- invalid outputs stop continuity
- transport adapters stay outside kernel logic

### Memory

Owns memory strata, retrieval policy, provenance graph, retention logic, and evaluation harnesses.

Rules:

- memory informs planning and review but does not silently rewrite runtime truth

### GitHub

Owns projections into issues, comments, checks, milestones, reconciliation, and drift detection.

Rules:

- GitHub mirrors progress for humans
- GitHub does not become the transaction ledger

### SDK

Owns stable external contracts for clients, internal tooling, and future automation integrations.

Rules:

- wraps public types and transport-safe payloads
- does not expose unstable internal reducers directly

### UI

Owns operator-facing components, design system primitives, and views over control-plane data.

Rules:

- UI reads projected state and control APIs
- UI does not invent execution semantics

## Application boundaries

### `apps/control-web`

Primary operator UI for timelines, approvals, drift, and company onboarding.

### `server/control-plane`

Backend API for timelines, event streams, approvals, control endpoints, and operator actions.

### `server/github-app`

Dedicated surface for GitHub webhooks, outbound sync, reconciliation, and audit events.

## Ownership model

- `packages/domain` and `packages/kernel` are architectural core and require the highest review bar
- `packages/orchestration`, `packages/execution`, `packages/memory`, and `packages/github` are policy-heavy domains with explicit contract tests
- `apps/control-web` and `packages/ui` can evolve faster as long as they do not redefine kernel semantics
- `server/control-plane` composes services; it should not absorb domain logic that belongs in packages

## Clean-room advantages

- concepts inspired by external systems can be re-authored without importing their code shape
- contracts stay native to Escalona Labs naming and semantics
- each context can be implemented incrementally with contract tests instead of giant rewrites

## Boundary rules that must hold

- reducers never call tools
- GitHub sync never mutates ledger truth directly
- execution adapters never define business workflow state
- UI does not couple itself to raw ledger internals
- naming lives in one canonical map and is reused everywhere else

## Sequencing

1. Define domain and kernel contracts
2. Add GitHub projection and orchestration contracts
3. Implement execution and memory boundaries
4. Build server and UI around those stable seams
