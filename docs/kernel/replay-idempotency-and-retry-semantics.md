# Replay, Idempotency, And Retry Semantics

## Purpose

Define how the kernel rebuilds truth, suppresses duplicates, and retries safely without breaking determinism.

## Replay modes

### Aggregate replay

Rebuild one aggregate by folding its ordered event stream.

Use for:

- current state reconstruction
- invariant validation
- point-in-time debugging

### Projection replay

Recompute one read model from canonical events.

Use for:

- GitHub sync repair
- dashboard correction
- drift recovery

### Simulation replay

Re-run the reducer and policy engine against a historical trace without re-emitting side effects.

Use for:

- regression testing
- golden-trace verification
- behavior comparison across schema versions

## Replay rules

- replay never re-executes external tools
- replay consumes canonical events in stream order
- any event schema upgrade must remain replay-compatible or provide an explicit migration path
- snapshots are accelerators only; the event stream remains authoritative

## Command idempotency

Every mutating command should carry:

- `command_id`
- `company_id`
- `aggregate_id`
- `command_type`
- `idempotency_key`

Rules:

- the same idempotency key for the same command target must not create duplicate state transitions
- duplicate commands must return the already-recorded outcome or an explicit duplicate result
- idempotency windows should be effectively unbounded for ledgered commands because correctness matters more than convenience

## Run idempotency

- one execution packet creates at most one run
- one run attempt owns at most one effect bundle and one terminal outcome
- retries create new run identifiers and increment `attempt`

## Retry classification

### Retryable failures

- transient tool transport failures
- temporary infrastructure outage
- temporary lease interruption if policy permits re-acquisition

### Non-retryable failures

- approval denied
- output contract invalid with no new input
- policy violation
- permanent executor incompatibility
- exclusive claim conflict that requires replanning rather than rerun

## Retry rules

- retries are explicit events, not hidden loops inside executors
- a retry must create a new run and new execution packet
- retry count is bounded by policy on the work item
- retries may reuse the same work item, but never mutate the historical attempt
- backoff strategy is policy-driven and deterministic from the recorded failure class

## Result validation interaction

- output validation happens before success is recorded
- a validation failure may be retryable or permanent depending on failure class
- if validation depends on missing artifacts, the run becomes blocked or transiently failed, never implicitly successful

## Duplicate suppression

Duplicate suppression must exist at:

- command ingestion
- run creation
- external effect acknowledgement
- projection delivery

Rule:

- suppress the duplicate while still recording enough audit data to explain what was ignored and why

## Forbidden patterns

- “retry in place” on the same run identifier
- silent packet mutation between attempts
- reusing a transient tool response during replay as if it were a new execution
- interpreting repeated “pending” chatter as permission to retry

## Practical policy defaults

- default retry budget per work item: small and explicit
- transient failure classes: retry allowed
- semantic or policy failures: no automatic retry
- approval-related failures: wait for a new approval event or human action
