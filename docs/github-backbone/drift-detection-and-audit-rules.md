# Drift Detection And Audit Rules

## Purpose

Define how the platform detects, classifies, stores, and explains divergence between kernel truth and GitHub projections.

## Drift definition

Drift exists when a GitHub projection no longer matches the latest canonical intent or observable state recorded in the kernel.

## Drift classes

### Projection lag

The kernel is ahead, but GitHub has not been updated yet.

### Delivery failure

The projection worker attempted delivery and failed.

### Unauthorized mutation

A protected GitHub field was changed outside the allowed command paths.

### Missing object

Expected issue, comment, or check is missing in GitHub.

### Metadata mismatch

Hidden metadata or linkage identifiers no longer match the target aggregate.

### Policy mismatch

GitHub appears to show a state that the kernel would never authorize, such as a completed item after approval denial.

## Drift record

Every detected drift should store:

- `drift_id`
- `company_id`
- `aggregate_type`
- `aggregate_id`
- `github_object_ref`
- `drift_class`
- `severity`
- `source_event_id`
- `observed_at`
- `repair_status`
- `notes`

## Severity guidance

- `info`: lag or harmless formatting divergence
- `warn`: recoverable sync mismatch
- `high`: protected field mismatch or missing object blocking operators
- `critical`: divergence that could mislead approvals or delivery decisions

## Audit rules

- all projection writes must be traceable to source event ids
- all inbound reconcile decisions must reference the triggering GitHub event id
- all repairs must leave an audit trail even if the user-facing issue body is overwritten

## Repair policy

- benign drift may be repaired silently on next projection cycle
- high or critical drift should leave a visible note for operators
- repeated drift on the same object should escalate to a human review queue

## Operator view

The control plane should eventually expose:

- current drift count by severity
- oldest unrepaired drift
- affected objectives and work items
- last successful projection time

## Success condition

An operator should always be able to answer:

- what diverged
- when it diverged
- what the kernel thinks is true
- whether the system repaired it or needs human action
