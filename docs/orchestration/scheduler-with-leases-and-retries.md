# Scheduler With Leases And Retries

## Purpose

Define queue semantics, leases, retries, and concurrency caps so the scheduler preserves replayability and prevents ambiguous ownership.

## Scheduler responsibilities

- select eligible ready work items
- allocate them to agents with active capability and policy fit
- issue leases over exclusive scopes
- enforce retry budgets
- stop repeated no-op loops

## Queue model

### Ready queue

Work items that have satisfied dependencies and approvals.

### Approval queue

Work items blocked on human or policy decision.

### Retry queue

Work items whose prior run failed transiently and remain retry-eligible.

### Escalation queue

Work items requiring human or planner intervention.

## Lease rules

- a lease is required before execution when a scope is exclusive
- lease duration is finite and explicit
- lease renewal must be evented
- expired lease returns the work item to blocked, retry, or planner review depending on policy

## Scheduling rules

- one active run per work item
- one exclusive lease per protected scope
- concurrency caps apply at company, agent class, and scope-group levels
- the scheduler never dispatches work that still lacks approval or validation definition

## Retry rules

- scheduler only retries transiently failed runs
- retries create new run attempts and new packets
- retry backoff is deterministic from the failure class and attempt number
- exceeding retry budget escalates instead of spinning

## No-op loop prevention

The scheduler must refuse to redispatch a work item when all of these are unchanged:

- same work item state
- same blocking conditions
- same packet inputs
- same dependency closure
- same failure class

If nothing causal changed, the next state is escalation or wait, not redispatch.

## Dispatch result classes

- `dispatched`
- `withheld_missing_approval`
- `withheld_scope_conflict`
- `withheld_retry_budget_exhausted`
- `withheld_no_new_causal_input`
- `escalated`

## Success condition

At any time the scheduler should explain:

- why a work item was dispatched
- why it was withheld
- what exact event would make it eligible again
