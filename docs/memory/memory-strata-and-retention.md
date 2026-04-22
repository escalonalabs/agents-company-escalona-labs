# Memory Strata And Retention

## Purpose

Define the memory layers, retention windows, and intended uses for each layer without mixing memory with runtime truth.

## Rule of separation

The ledger stores facts. Memory stores reusable context derived from facts.

## Memory strata

### Ephemeral working memory

Use:

- one active run
- transient reasoning scratchpad

Retention:

- discarded when the run ends unless explicitly promoted

### Operational memory

Use:

- recent run summaries
- recurring blockers
- recent approvals and escalations

Retention:

- medium-term
- retained while active delivery context is still relevant

### Knowledge memory

Use:

- stable conventions
- validated lessons
- reusable patterns backed by evidence

Retention:

- long-lived until explicitly invalidated or superseded

### Audit memory

Use:

- provenance references
- evidence trails
- recall evaluation baselines

Retention:

- long-lived and policy-driven

## Retention rules

- ephemeral memory must never silently survive into future runs
- operational memory expires or degrades unless refreshed by new evidence
- knowledge memory requires provenance and confidence
- audit memory must remain traceable to artifacts and events
