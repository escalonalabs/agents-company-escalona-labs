# Runtime State Machine And Event Schema

## Purpose

Specify the allowed runtime states, transition rules, and typed event families that make the kernel replayable and explainable from first principles.

## State modeling rules

- transitions happen only through typed events
- terminal states are explicit and irreversible
- side effects may produce events, but side effects never become the source of truth
- approvals, claims, and validation are first-class transitions, not comments attached after the fact

## Work item lifecycle

### States

- `proposed`
- `ready`
- `waiting_for_approval`
- `queued`
- `leased`
- `running`
- `validating_result`
- `completed`
- `blocked`
- `failed`
- `cancelled`

### Allowed transitions

- `proposed -> ready`
- `ready -> waiting_for_approval`
- `ready -> queued`
- `waiting_for_approval -> queued`
- `waiting_for_approval -> blocked`
- `queued -> leased`
- `leased -> running`
- `leased -> blocked`
- `running -> validating_result`
- `running -> failed`
- `running -> blocked`
- `validating_result -> completed`
- `validating_result -> failed`
- `validating_result -> blocked`
- `any non-terminal -> cancelled`

### Rules

- `running` requires an active lease and a created run
- `completed`, `failed`, and `cancelled` are terminal
- `blocked` is resumable only through an explicit unblock event

## Run lifecycle

### States

- `created`
- `dispatched`
- `executing`
- `awaiting_validation`
- `succeeded`
- `failed_transient`
- `failed_permanent`
- `cancelled`

### Allowed transitions

- `created -> dispatched`
- `dispatched -> executing`
- `executing -> awaiting_validation`
- `executing -> failed_transient`
- `executing -> failed_permanent`
- `executing -> cancelled`
- `awaiting_validation -> succeeded`
- `awaiting_validation -> failed_permanent`
- `awaiting_validation -> failed_transient`

### Rules

- a run may only enter `executing` if its execution packet is frozen
- `failed_transient` may authorize retry creation if retry policy allows it
- `failed_permanent` forbids automatic retry

## Approval lifecycle

### States

- `requested`
- `granted`
- `denied`
- `expired`
- `cancelled`

### Rules

- approvals are terminal once granted, denied, expired, or cancelled
- only `granted` may unblock a waiting control boundary

## Claim lease lifecycle

### States

- `requested`
- `active`
- `released`
- `expired`
- `rejected`

### Rules

- only one active exclusive claim may exist for a scope
- `expired` and `released` must be evented explicitly

## Event envelope

Every event in the ledger should carry:

- `event_id`
- `event_type`
- `schema_version`
- `aggregate_type`
- `aggregate_id`
- `stream_sequence`
- `company_id`
- `occurred_at`
- `actor_ref`
- `causation_id`
- `correlation_id`
- `command_id`
- `payload`

## Event families

### Objective events

- `objective.created`
- `objective.reprioritized`
- `objective.cancelled`
- `objective.completed`

### Work item events

- `work_item.created`
- `work_item.readied`
- `work_item.approval_requested`
- `work_item.queued`
- `work_item.leased`
- `work_item.unblocked`
- `work_item.blocked`
- `work_item.entered_validation`
- `work_item.completed`
- `work_item.failed`
- `work_item.cancelled`

### Run events

- `run.created`
- `run.dispatched`
- `run.started`
- `run.output_received`
- `run.validation_passed`
- `run.validation_failed`
- `run.failed_transient`
- `run.failed_permanent`
- `run.cancelled`

### Approval events

- `approval.requested`
- `approval.granted`
- `approval.denied`
- `approval.expired`
- `approval.cancelled`

### Claim events

- `claim.requested`
- `claim.activated`
- `claim.released`
- `claim.expired`
- `claim.rejected`

### Artifact events

- `artifact.recorded`
- `artifact.superseded`
- `artifact.validation_attached`

### Projection and integration events

- `projection.enqueued`
- `projection.applied`
- `projection.failed`
- `projection.reconciled`
- `projection.drift_detected`

These events do not redefine aggregate truth. They describe the delivery of truth into a read surface.

## Payload expectations

### Identity

Payloads must include stable identifiers, never only titles or display names.

### Before/after shape

Mutation events should include either:

- the new canonical value, or
- an explicit old/new pair when needed for audit clarity

### Policy references

Any event that depends on policy must include the policy snapshot reference used at decision time.

### Validation data

Validation events must include:

- expected schema reference
- artifact or output references
- validator identity
- failure class if validation failed

## Failure boundaries

- invalid output cannot emit `work_item.completed`
- denied approval cannot emit `work_item.queued`
- expired claim cannot coexist with `run.executing`
- projection failure cannot mutate aggregate state to success

## Known anti-patterns forbidden by design

- inferring completion from absence of errors
- moving from `running` to `completed` without validation
- using free-form comments as state transitions
- allowing repeated “pending” loops with no new event type or causal input
