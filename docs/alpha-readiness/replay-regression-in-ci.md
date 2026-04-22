# Replay Regression In CI

## Purpose

Define the merge gate that prevents replay and trace-contract regressions from landing unnoticed before the runtime is fully implemented.

## Alpha gate design

The initial replay gate is contract-first:

- canonical fixtures live in `tests/golden/kernel/`
- validation lives in `.github/scripts/check_replay_regression.py`
- CI enforcement lives in `.github/workflows/replay-regression.yml`
- branch protection requires the `replay-regression` check on `main`

## What the gate validates today

- every required golden-trace scenario exists
- every trace fixture parses as valid JSON
- required top-level fields exist and keep stable names
- `trace_id` values stay unique
- command and event entries remain machine-readable
- known loop prevention retains hard invariants against no-op redispatch

## Required alpha scenario baseline

- happy path
- approval gate
- approval denial
- duplicate command
- transient retry
- permanent validation failure
- claim expiry
- projection drift
- known loop prevention

## Fail-closed rule

If a fixture becomes unreadable, drops a required scenario, or weakens a required invariant, the pull request must fail.

## Why this is still useful before runtime implementation

The platform already has contractual expectations for replay through:

- golden trace harness design
- scheduler safety rules
- execution packet immutability
- projection drift recovery

This gate prevents those expectations from silently eroding while implementation catches up.

## Upgrade path

When the reducer and replay engine exist, the same workflow should add:

- reducer execution against fixtures
- exact event diffing
- projection rebuild checks
- invariant evaluation against materialized output

The fixture format is intentionally strict enough to survive that upgrade without being replaced.
