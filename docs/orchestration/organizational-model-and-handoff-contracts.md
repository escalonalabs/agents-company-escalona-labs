# Organizational Model And Handoff Contracts

## Purpose

Define the company-of-agents structure, role boundaries, and allowed handoff semantics so work allocation never depends on conversational ambiguity.

## Organizational principle

The system organizes work around bounded responsibility, not around theatrical agent conversations.

## Core orchestration roles

### Planner

Transforms objectives into a plan graph of bounded work items.

Authority:

- may decompose work
- may propose dependencies
- may not execute tools or close work items

### Scheduler

Allocates ready work items to eligible agents under leases, concurrency caps, and retry policy.

Authority:

- may dispatch and reclaim work
- may not rewrite objective intent or validation contracts

### Specialist agent

Executes one bounded work item under one frozen execution packet.

Authority:

- may produce outputs and artifacts
- may not self-assign broader scope or create downstream work outside the allowed result contract

### Reviewer or validator

Checks whether output satisfies the declared validation contract.

Authority:

- may pass or fail validation
- may not silently reinterpret the work item goal

### Human operator

Approves, overrides, reprioritizes, or cancels at explicit control boundaries.

Authority:

- final authority on approvals and overrides
- still operates through explicit commands, not informal narrative

## Handoff contract

Every handoff must carry:

- `handoff_id`
- `from_role`
- `to_role`
- `work_item_id`
- `source_event_id`
- `handoff_reason`
- `required_action`
- `blocking_conditions`
- `artifact_refs`
- `validation_contract_ref`

## Allowed handoff reasons

- plan decomposition completed
- approval granted
- lease acquired
- retry authorized
- validation failed and replan required
- human override requested

## Forbidden handoff patterns

- “verification pending” with no new evidence
- “please continue” with no state transition
- repeated pass-through messages that do not change ownership, policy, or validation context
- direct specialist-to-specialist delegation outside the planner or scheduler rules

## Ownership rule

- at any moment, one active role owns the next meaningful action on a work item
- informational comments do not transfer ownership
- ownership only changes through a recorded handoff event

## Loop prevention rule

A work item may not re-enter the same role with the same packet, same blockers, and no new causal input.

Valid new causal input means:

- new approval decision
- new artifact or validation result
- new lease outcome
- new human override
- new planner revision

## Success condition

The orchestration layer should be able to answer, for any active work item:

- who owns it now
- why they own it
- what event transferred that ownership
- what evidence is required before it can move again
