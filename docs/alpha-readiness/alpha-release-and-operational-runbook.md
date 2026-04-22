# Alpha Release And Operational Runbook

## Purpose

Prepare the release checklist, rollback path, and day-one operating routine for alpha.

## Preflight checklist

- `repo-guardrails`, `dependency-review`, `secret-scan`, and `replay-regression` are green on `main`
- required M7 documents are merged and linked from the release issue
- GitHub App installation and webhook health are verified for the target company
- operator dashboard shows healthy control-plane availability and projection freshness
- open `sev0` and `sev1` items are zero

## Release package

The alpha handoff packet should include:

- release scope summary
- known limits and accepted residual risks
- current SLOs and alert thresholds
- linked reference workflows
- rollback instructions
- operator contact and escalation path

## Launch sequence

1. open the release issue and link the target commit or tag
2. run the reference workflow checks in order
3. verify GitHub projection freshness is within target
4. verify no pending high-risk approvals are unresolved
5. announce alpha open only after the above checks pass

## Day-one operator routine

- monitor availability, dispatch latency, and projection freshness
- review pending approvals and drift alerts
- review repeated invalid outputs or retry storms
- document any manual override directly in GitHub and the operator timeline

## Rollback triggers

- repeated `sev1` projection integrity failures
- control plane unavailable beyond the alpha SLO budget
- invalid outputs bypassing downstream safety
- missing or corrupt audit records for approvals or control actions

## Rollback path

1. freeze new objective intake
2. cancel or pause unsafe work items through bounded control actions
3. disable projection or executor paths causing unsafe churn
4. restore the last known healthy release or feature flag posture
5. write the incident and rollback evidence before reopening alpha

## Post-incident rule

No relaunch occurs from chat memory. Relaunch requires:

- documented incident summary
- explicit fix or mitigation
- replay or workflow evidence showing the failure mode is contained

## Exit condition

Alpha operations are considered ready when launch, degraded operation, and rollback can all be executed from repository-owned artifacts without relying on tribal knowledge.
