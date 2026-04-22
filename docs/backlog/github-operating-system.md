# GitHub Operating System

## Working rules

- Every meaningful implementation starts from a GitHub issue
- Every pull request must reference at least one issue key
- Every issue must include a Definition of Done or explicit validation target
- Incomplete work returns to GitHub with status and blockers recorded
- No work item is considered done from chat alone

## Labels

### Type

- `type:epic`
- `type:spec`
- `type:feature`
- `type:integration`
- `type:infra`
- `type:test`
- `type:security`
- `type:docs`

### Area

- `area:foundation`
- `area:brand`
- `area:kernel`
- `area:github`
- `area:orchestration`
- `area:runtime`
- `area:memory`
- `area:api`
- `area:ui`
- `area:release`

### Priority and sizing

- `P0`
- `P1`
- `P2`
- `size:S`
- `size:M`
- `size:L`

### State and track

- `state:ready`
- `state:blocked`
- `state:needs-decision`
- `track:mvp`
- `track:post-mvp`

## Milestones

- `M0 Foundation`
- `M1 Kernel v1`
- `M2 GitHub Backbone`
- `M3 Orchestration`
- `M4 Execution Plane`
- `M5 Memory`
- `M6 Control Plane`
- `M7 Alpha Readiness`

## Definitions of Done by milestone

- `M0`: governance scaffold, roadmap, naming, and CI guardrails are live
- `M1`: kernel contracts are documented and replayable in design
- `M2`: GitHub mapping and drift controls are documented
- `M3`: company orchestration semantics are explicit and testable in simulation
- `M4`: execution contracts are fail-closed and policy-aware
- `M5`: memory model is evaluable and provenance-aware
- `M6`: operator-facing API and UI surfaces are defined
- `M7`: alpha release path is observable, reviewable, and reversible

## Bootstrap rules

- `.github/scripts/bootstrap_github.py` seeds and repairs labels, milestones, and issue metadata
- Existing issue labels are preserved by default when syncing issues so live workflow state is not overwritten
- `--sync-issue-labels` is an explicit repair mode and should only be used when intentionally resetting issue labels to the seeded baseline
- `--delete-default-labels` and `--protect-main` are explicit operations and do not trigger a full backlog reseed on their own

## Known external blocker

- Branch protection for `main` on a private repository requires a GitHub plan that supports protected branches on private repos
- If the current plan does not support that capability, the bootstrap script fails closed with a clear error instead of silently skipping protection
