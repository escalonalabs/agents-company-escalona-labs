# End-To-End Reference Workflows

## Purpose

Define the small set of realistic workflows that will gate alpha readiness end to end.

## Workflow 1: Modular feature delivery

Scenario:

- objective creates bounded backend, UI, and documentation work items
- work items execute in parallel on non-overlapping scopes
- GitHub issues, checks, and projection views stay aligned

Must prove:

- planner output is decomposable
- scheduler enforces exclusive scope correctly
- successful runs project cleanly into GitHub progress

## Workflow 2: Approval-gated risky action

Scenario:

- a work item requires approval before an executor with elevated scope can run
- operator grants or denies through the control plane

Must prove:

- execution pauses safely while approval is pending
- denied approval prevents downstream continuity
- approval history is visible in timeline and audit records

## Workflow 3: Known loop suppression

Scenario:

- a historical `pending / verification pending / continue` pattern is replayed without new causal input

Must prove:

- scheduler suppresses no-op redispatch
- system emits blocked, escalated, or review-needed state instead of churn
- replay fixtures and operator timeline tell the same story

## Workflow 4: Projection lag and drift recovery

Scenario:

- GitHub projection falls behind or diverges on a protected field

Must prove:

- drift alert points to the affected aggregate
- runtime ledger remains authoritative
- reconciliation can restore GitHub without corrupting runtime truth

## Workflow 5: Alpha release drill

Scenario:

- preflight checks pass, release is opened, one degraded-path signal appears, and rollback is exercised

Must prove:

- launch checklist is executable
- operators know which metrics and alerts decide go or no-go
- rollback path is explicit and bounded

## Acceptance rule

Alpha is not gated by the number of workflows. It is gated by whether this set covers:

- parallel work
- approval safety
- replay safety
- GitHub projection integrity
- operational launch discipline
