# Persistent Ledger And Materialized Projections

## Purpose

Separate the source of runtime truth from the read models needed by operators, integrations, and GitHub.

## Architectural decision

Use an append-only ledger as the kernel write model and build materialized projections from that ledger for all human-facing and integration-facing surfaces.

## Why this split matters

- replay must remain possible even when projections drift
- GitHub and UI surfaces need query-optimized shapes that reducers should not own directly
- projection failure must not corrupt kernel truth

## Ledger design

## Core tables or streams

### `event_log`

Canonical append-only event store.

Columns:

- `event_id`
- `company_id`
- `aggregate_type`
- `aggregate_id`
- `stream_sequence`
- `event_type`
- `schema_version`
- `occurred_at`
- `actor_ref`
- `causation_id`
- `correlation_id`
- `command_id`
- `payload_json`

Constraints:

- unique on `event_id`
- unique on `aggregate_id + stream_sequence`

### `command_log`

Tracks mutating command ingestion and idempotency.

Columns:

- `command_id`
- `idempotency_key`
- `aggregate_id`
- `command_type`
- `received_at`
- `resolution_status`
- `result_event_ids`

### `snapshot_store`

Optional replay accelerator.

Columns:

- `aggregate_id`
- `aggregate_type`
- `last_event_sequence`
- `state_blob`
- `created_at`

Rule:

- snapshots are disposable caches and may always be rebuilt

### `projection_checkpoint`

Tracks how far each projection consumer has processed the ledger.

Columns:

- `projection_name`
- `company_id`
- `last_event_id`
- `last_stream_position`
- `updated_at`

### `projection_outbox`

Queues integration-facing deliveries such as GitHub sync operations.

Columns:

- `projection_delivery_id`
- `projection_name`
- `source_event_id`
- `delivery_key`
- `status`
- `attempt_count`
- `next_attempt_at`
- `last_error`

## Projection families

### Objective and work queue projections

Used by operator backlog and planning views.

### Run timeline projection

Used to explain what happened, in order, for a work item or objective.

### Approval inbox projection

Used to show pending human decisions and expired gates.

### Artifact index projection

Used to discover logs, outputs, and validation evidence.

### GitHub projection

Used to map:

- objectives to epics
- work items to issues
- run status to comments or checks
- approval state to issue or PR metadata

### Drift projection

Used to show mismatches between ledger truth and external surfaces.

## Projection rules

- projections are rebuildable from ledger truth
- projections must be idempotent by delivery key
- projection state may be denormalized aggressively for read performance
- projection failure records `projection.failed`; it does not rewrite aggregate state

## Storage recommendation

Start with PostgreSQL for both ledger and projections.

Why:

- strong transactional guarantees
- straightforward append-only and checkpoint patterns
- relational support for operator views and audit queries
- lower complexity than introducing a distributed log too early

## Evolution rules

- event schema changes require versioning, not mutation of history
- projection schemas may evolve independently as long as they remain rebuildable
- GitHub mapping can change without rewriting kernel history

## Anti-patterns to avoid

- putting GitHub issue state directly into aggregate truth
- storing only final state without event history
- using projections as write authority
- treating background sync success as proof of execution success
