# M8-M10 Debt Closure Plan

## Purpose

Close the verified implementation gaps between the documented milestone promises and the runtime that exists today.

This plan is intentionally narrow:

- it does not redesign `M11+`
- it does not reopen settled product direction
- it only closes the concrete debt that currently blocks `M8`, `M9`, and `M10` from being called complete

## Verified gap baseline

### M8 Buildable Foundation

- `pnpm typecheck` does not pass in the current tree
- workspace integrity is weaker than the root scripts imply
- the documented bootstrap path is not proven by a fresh-clone smoke gate

### M9 Domain and Kernel Runtime v1

- reducer and replay code exist
- CI replay enforcement is still contract-first, not runtime-first
- golden traces are not yet executed as real reducer or projection regression tests

### M10 Orchestration and Execution Plane v1

- execution packets and result validation exist
- claim leases exist in domain language but not as persisted operational runtime truth
- retry semantics exist mostly as mapping logic, not as a real scheduler loop
- dispatch creates runs, but no dedicated worker consumes them end to end
- the documented MVP tool pack is not implemented as real bounded executors

## Non-negotiable closure rules

`M8`, `M9`, and `M10` stay open until all of these are true:

1. every child issue in this plan is closed with repository evidence
2. `pnpm check:repo` passes
3. `pnpm check:replay` passes
4. `pnpm lint` passes
5. `pnpm typecheck` passes
6. `pnpm test` passes
7. `pnpm build` passes
8. the runtime smoke suite proves `objective -> work item -> run -> worker -> validation -> terminal state`
9. no completion claim for `M10` depends on a manual operator call to `/runs/:runId/complete`

## Critical path

1. Fix `M8` workspace integrity first
2. Upgrade `M9` replay from fixture-shape validation to runtime execution
3. Persist claims before attempting real concurrent runtime scheduling
4. Implement scheduler retry and withholding semantics before the worker loop
5. Ship the worker before the executor pack
6. Ship the executor pack before the final end-to-end smoke suite

## Execution plan

### Phase 1: M8 foundation hardening

#### `AC-811` Restore workspace typecheck parity and package source integrity

Goal:

- make the workspace graph honest
- remove package entries that fail because they have no real source inputs
- ensure every package referenced by root scripts has a valid source entry or an explicit exclusion

Expected artifacts:

- corrected package source layout or package config
- passing root `pnpm typecheck`
- explicit decision for any placeholder package that should not yet participate in root validation

Exit proof:

- `pnpm typecheck`

#### `AC-812` Add a fresh-clone smoke gate for the documented bootstrap path

Goal:

- prove the README path instead of assuming it
- catch bootstrap drift between docs, scripts, Docker Compose, and database setup

Expected artifacts:

- one smoke command or workflow that follows the documented bootstrap path
- smoke output captured in CI or a documented local script

Exit proof:

- smoke gate passes from a clean environment

### Phase 2: M9 replay made real

#### `AC-911` Execute golden traces against the real kernel reducer

Goal:

- upgrade replay from schema validation to real reducer execution
- ensure fixture changes can break CI for real runtime regressions

Expected artifacts:

- test harness that loads `tests/golden/kernel/*.json`
- mapping from fixture commands and events into kernel replay inputs
- reducer execution wired into CI

Exit proof:

- replay job fails when reducer output diverges from fixture expectations

#### `AC-912` Assert exact replay outputs, projection rebuilds, and loop invariants

Goal:

- make replay checks strict enough to protect the historical failure modes already documented

Expected artifacts:

- exact aggregate-state assertions
- projection rebuild assertions
- explicit invariant checks for retry, approval, claim-expiry, drift, and no-op loop prevention

Exit proof:

- known loop class regresses only by failing CI

### Phase 3: M10 runtime completion

#### `AC-1002` Persist claim leases and enforce exclusive scope ownership

Goal:

- move claims from vocabulary to runtime truth
- stop using `running work item with same scope` as the ownership mechanism

Expected artifacts:

- claim lease persistence model
- claim acquisition and expiry events
- DB access layer for active-claim lookup and mutation
- scheduler enforcement based on active claims

Exit proof:

- exclusive-scope conflict is prevented by lease state, not by incidental run status

#### `AC-1003` Implement deterministic retry scheduling and withholding semantics

Goal:

- turn retry behavior into a real scheduling policy
- make withheld and escalated outcomes explicit and replayable

Expected artifacts:

- ready, retry, and escalation selection logic
- deterministic backoff from attempt number and failure class
- retry-budget exhaustion path
- explicit withheld reasons including `retry_budget_exhausted`

Exit proof:

- transient failure produces a new attempt only when policy allows it
- no-new-causal-input and exhausted-retry cases never spin

#### `AC-1004` Ship the worker runtime and Postgres-backed run queue

Goal:

- introduce the actual runtime process that consumes queued work
- make packet execution automatic, not manually finished through the operator API

Expected artifacts:

- dedicated worker entrypoint and package script
- Postgres-backed dequeue and ack lifecycle
- packet load, execution, result capture, and terminal writeback path
- graceful shutdown and idempotent dequeue behavior

Exit proof:

- the happy path completes without a human calling `/runs/:runId/complete`

#### `AC-1005` Implement bounded HTTP, file, and internal executors

Goal:

- ship the first useful subset of the execution plane behind real policy boundaries

Expected artifacts:

- typed effect envelopes
- HTTP executor with endpoint allowlists
- file and artifact executor with scope-bound access
- internal executor for repair, simulation, and control actions

Exit proof:

- allowed operations execute through the worker
- forbidden operations fail closed with typed output

#### `AC-1006` Implement bounded shell and browser executors

Goal:

- complete the documented MVP tool pack without bypassing policy

Expected artifacts:

- shell executor with frozen command, working directory, and environment policy
- browser executor with domain allowlists and evidence capture
- shared result envelope compatibility with the rest of the execution plane

Exit proof:

- shell and browser actions can be audited from the same execution record model

#### `AC-1007` Add end-to-end runtime smoke and failure-path tests

Goal:

- prove the runtime as a system, not just as isolated helper functions

Required scenarios:

- happy path
- invalid output
- transient failure followed by retry
- claim conflict
- lease expiry
- no-op loop prevention

Expected artifacts:

- smoke harness that boots the worker and control-plane runtime together
- assertions for terminal state, result contract, and event chronology
- one command suitable for local and CI execution

Exit proof:

- the system proves its happy and failure paths under automated test

## Parallelization guidance

Work can overlap, but not arbitrarily:

- `AC-811` starts first
- `AC-812` can begin once the workspace graph is stable
- `AC-911` and `AC-912` should complete before `M10` is declared done, because `M10` depends on those replay guarantees for regression protection
- `AC-1002` and `AC-1003` form the orchestration spine and should land before the worker
- `AC-1005` and `AC-1006` can split once the worker contract is stable
- `AC-1007` is last by design

## Exit checklist by milestone

### M8 may close when

- `AC-811` and `AC-812` are closed
- the workspace graph is stable
- the bootstrap path is proven

### M9 may close when

- `AC-911` and `AC-912` are closed
- replay regressions execute real code
- loop-prevention behavior is protected by tests, not by documents

### M10 may close when

- `AC-1002` through `AC-1007` are closed
- claim ownership is persisted and explicit
- retries are deterministic and bounded
- a real worker settles runs
- the documented MVP tool pack exists as bounded executors
- end-to-end runtime smoke tests pass without manual operator completion

## What this plan intentionally avoids

- no new product line
- no architecture rewrite beyond what is required to satisfy `M8-M10`
- no moving debt into `M11+`
- no re-labeling milestones as complete while they still depend on chat-only or contract-only behavior
