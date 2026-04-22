# Platform Rebuild Roadmap

## Mission

Build a new company-of-agents platform under the Escalona Labs brand with a deterministic coordination kernel, GitHub-first progress management, and clean-room implementation rules.

## Delivery shape

- `M0 Foundation`
- `M1 Kernel v1`
- `M2 GitHub Backbone`
- `M3 Orchestration`
- `M4 Execution Plane`
- `M5 Memory`
- `M6 Control Plane`
- `M7 Alpha Readiness`

## Non-negotiables

- GitHub is the backlog and human progress system
- The runtime kernel keeps its own deterministic ledger
- No agent executes without a frozen execution packet
- No invalid output can trigger downstream continuity
- No overlapping exclusive claims resolve via last-write-wins

## Milestone outcomes

### M0 Foundation

- Repository scaffold exists
- Brand seed and naming system are defined
- GitHub operating system is installed
- CI guardrails block prohibited repository identifiers

### M1 Kernel v1

- Canonical domain model defined
- Runtime state machine and event schema defined
- Replay and idempotency semantics defined
- Golden trace harness designed

### M2 GitHub Backbone

- Kernel-to-GitHub mapping defined
- GitHub App permissions and sync contracts defined
- Drift model and audit rules defined

### M3 Orchestration

- Company model and handoff contracts defined
- Planner and scheduler semantics defined
- Approval and escalation rules defined

### M4 Execution Plane

- Effect envelopes and executor boundaries defined
- Capability policy model defined
- Artifact storage and task-result contract defined

### M5 Memory

- Memory strata defined
- Extraction, retrieval, and provenance flows defined
- Evaluation suite for recall and contamination designed

### M6 Control Plane

- Public API surface defined
- Timeline and control endpoints defined
- Operator UI and GitHub-linked progress views designed

### M7 Alpha Readiness

- Observability model defined
- Replay regression enforced in CI
- Security review closed
- Release and rollback runbook ready

## Build order

1. Foundation and naming
2. Deterministic kernel contracts
3. GitHub integration contracts
4. Orchestration and execution controls
5. Memory and operator UX
6. Alpha readiness and release discipline

