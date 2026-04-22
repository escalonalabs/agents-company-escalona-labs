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
- `M8 Buildable Foundation`
- `M9 Domain and Kernel Runtime v1`
- `M10 Orchestration and Execution Plane v1`
- `M11 GitHub Backbone Runtime`
- `M12 Control Plane MVP`
- `M13 Memory and Provenance v1`
- `M14 Customer Foundations`
- `M15 Production Infrastructure and Reliability`
- `M16 Internal Alpha and Controlled Beta`
- `M17 General Availability`

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
- Reference workflows defined for launch gating
- Release and rollback runbook ready

### M8 Buildable Foundation

- Runnable pnpm monorepo exists
- Local Docker Compose dependencies exist
- App, servers, and packages compile
- Code CI exists beyond repository guardrails

### M9 Domain and Kernel Runtime v1

- Canonical domain types exist in code
- Ledger-backed reducer exists
- Replay runs against real code
- Golden traces validate runtime behavior

### M10 Orchestration and Execution Plane v1

- Planning and scheduling exist in code
- Execution packets and validators exist
- Worker runtime exists
- First bounded tool pack executes end to end

### M11 GitHub Backbone Runtime

- GitHub App auth exists
- Webhooks and sync exist
- Reconciliation and drift detection exist
- GitHub mirrors runtime truth for humans

### M12 Control Plane MVP

- Auth and session management exist
- Operator APIs exist
- Control web app exists
- Real runtime activity can be inspected and controlled from UI

### M13 Memory and Provenance v1

- Memory extraction and retrieval exist
- Provenance graph exists
- Contamination controls exist
- Memory remains auditable and bounded

### M14 Customer Foundations

- Multi-company isolation exists
- Invitations and onboarding exist
- Multi-repo support exists
- Self-hosted packaging foundations exist

### M15 Production Infrastructure and Reliability

- Hosted staging and production exist
- Observability exists
- Backup and restore are proven
- Reliability drills are operationalized

### M16 Internal Alpha and Controlled Beta

- Internal dogfooding is active
- Controlled external beta exists
- Release candidates are protected
- Rollback is proven on real releases

### M17 General Availability

- Strong GitHub protection returns on `main`
- Hosted and self-hosted docs are published
- Support and release discipline are explicit
- Product is customer-ready for GA

## Build order

1. Foundation and naming
2. Deterministic kernel contracts
3. GitHub integration contracts
4. Orchestration and execution controls
5. Memory and operator UX
6. Alpha readiness and release discipline
7. Executable monorepo foundation
8. Kernel runtime
9. Execution and orchestration
10. GitHub runtime integration
11. Operator control plane
12. Customer and production readiness
