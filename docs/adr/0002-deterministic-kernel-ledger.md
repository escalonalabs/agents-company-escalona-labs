# ADR 0002: Deterministic Kernel With Internal Ledger

## Status

Accepted

## Context

The platform must remain deterministic, replayable, and fail-closed even while exposing progress through GitHub.

## Decision

The runtime kernel will use an internal ledger for execution state, events, and replay semantics. GitHub will receive a projected representation of progress for human operation.

## Consequences

- Deterministic replay is preserved
- Human edits in GitHub cannot silently mutate runtime truth
- Drift must be detected and handled explicitly
- Integration design must include audit and reconciliation rules

