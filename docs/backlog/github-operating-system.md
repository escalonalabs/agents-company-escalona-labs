# GitHub Operating System

## Working rules

- Every meaningful implementation starts from a GitHub issue
- Every pull request must reference at least one issue key
- Every issue must include a Definition of Done or explicit validation target
- Incomplete work returns to GitHub with status and blockers recorded
- No work item is considered done from chat alone

## Lifecycle

### Intake

- work enters through an issue, epic, or documented decision
- every issue must carry milestone, labels, and validation intent

### Ready

- `state:ready` means a bounded slice can be executed without hidden decisions
- subagents should only pick work that is actually ready

### Blocked

- `state:blocked` means progress depends on an external action, irreversible decision, or missing prerequisite
- the blocking reason must be written into the issue

### In progress

- active work is represented by comments, linked pull requests, drafts, checks, or explicit assignment
- chat alone does not count as in-progress state

### Complete

- an issue closes only when evidence exists in the repository, checks, or linked delivery artifacts
- if something remains open, it is written back as new work instead of buried in a closing comment
- closed issues should not retain `state:*` labels

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

## Human and subagent contract

- humans decide roadmap, approvals, and irreversible product direction
- subagents work from explicit issues with bounded scope
- no subagent should execute outside the issue it was given
- every incomplete result returns to GitHub with status and evidence

## Branch protection status

- `main` is currently in temporary `Build Mode Casi Libre` during `M8` through `M15`
- direct push to `main` is allowed during Build Mode
- pull requests and review are optional during Build Mode, but milestone epics, ADRs, incidents, blockers, and releases still live in GitHub
- release candidate protection returns in `M16`
- strong protection returns to `main` in `M17`
- The temporary private-repo blocker was resolved by making the repository public on `2026-04-22`
- The bootstrap script still fails closed if protection cannot be applied in a future environment
