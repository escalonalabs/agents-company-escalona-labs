# Golden Trace Harness

## Purpose

Define the contract-test harness that future implementation work will use to prove reducer correctness, replay stability, and projection determinism against canonical traces.

## What a golden trace is

A versioned fixture that captures:

- input commands
- emitted events
- expected aggregate states
- expected projection states
- expected retry and duplicate-handling behavior

The fixture becomes a durable contract for behavior that must not drift unintentionally.

## Harness goals

- prove that the reducer emits the same events for the same causal inputs
- prove that replay rebuilds the same state
- prove that projections rebuild consistently from the same event stream
- prove that forbidden loops and silent continuations do not appear

## Fixture shape

Each trace should include:

- `trace_id`
- `schema_version`
- `scenario_name`
- `seed_state`
- `commands`
- `expected_events`
- `expected_terminal_aggregate_state`
- `expected_projection_state`
- `expected_invariants`

## Required scenario classes

### Happy path

Work item is created, leased, run, validated, and completed.

### Approval gate

Work item pauses for approval, then proceeds only after `approval.granted`.

### Approval denial

Work item stops safely and never enters execution.

### Duplicate command

Repeated command with same idempotency key emits no duplicate state transition.

### Transient retry

Run fails transiently, creates a new attempt, and eventually succeeds.

### Permanent validation failure

Output contract fails and no automatic retry is emitted.

### Claim expiry

Lease expires and the active run cannot continue as if ownership still existed.

### Projection drift

Projection is rebuilt from ledger truth and converges back to expected state.

### Known loop prevention

Historical “pending / verification pending / no new causal input” loops must assert no repeated continuation without a new event or decision.

## Assertions

The harness must assert:

- exact event ordering within an aggregate stream
- exact terminal aggregate state
- exact projection state for declared fields
- no forbidden event types are emitted
- retry count matches policy
- duplicate commands resolve deterministically

## Directory recommendation

```text
tests/golden/
  kernel/
    happy-path.json
    approval-denied.json
    transient-retry.json
    known-loop-prevention.json
```

## Versioning rules

- traces are immutable once adopted; incompatible changes create a new trace version
- expected behavior changes require explicit PR discussion because they are semantic changes, not test noise

## Practical rule

If a future implementation cannot explain a behavioral change through an intentional trace update, the change is a regression until proven otherwise.
