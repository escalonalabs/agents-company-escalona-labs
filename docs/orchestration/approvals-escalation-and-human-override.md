# Approvals, Escalation, And Human Override

## Purpose

Define when the system must pause, escalate, or accept explicit human intervention.

## Approval categories

- execution-risk approval
- scope-change approval
- destructive-action approval
- policy-exception approval

## Approval rules

- approvals are requested before the protected action, never after
- each approval request covers one bounded decision
- approval grant does not mutate history; it authorizes the next transition only

## Escalation triggers

- retry budget exhausted
- repeated validation failure
- no new causal input after blocked or pending state
- protected scope conflict that planning did not resolve
- operator-visible drift with high severity

## Human override types

- cancel work item
- requeue work item
- force planner revision
- grant or deny approval
- change priority
- mark a blocked state as intentionally deferred

## Override rules

- every override must become a typed command or event
- overrides are auditable and attributed
- override may change future behavior, but does not erase historical facts

## Safe pause rule

When a protected decision boundary is hit and no valid approval exists, the system must pause rather than continue optimistically.

## Anti-patterns

- approving by implication from silence
- converting human chat into approval without an explicit command path
- treating repeated agent confirmations as progress
