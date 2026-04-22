# Canonical Domain Model

## Purpose

Define the minimal write-model entities that the deterministic kernel must understand in order to plan, execute, approve, replay, and audit company-of-agents work without overlapping concepts.

## Modeling rules

- every write-model entity has one canonical identifier
- mutable runtime truth is expressed through events, not overwritten records
- projections and dashboards are not core domain entities
- execution permissions and policy references are explicit inputs, never hidden defaults

## Core entities

### Company

The top-level configured operating unit for one installation of agent work.

Fields:

- `company_id`
- `slug`
- `display_name`
- `status`
- `policy_set_ref`
- `github_installation_ref`
- `created_at`

Invariants:

- a company owns objectives, agents, policies, and operator surfaces
- a company may expose many projections, but runtime truth belongs to one ledger namespace

### Agent

A bounded worker definition, not a chat persona transcript.

Fields:

- `agent_id`
- `company_id`
- `role_key`
- `display_name`
- `capability_profile_ref`
- `policy_scope_ref`
- `execution_class`
- `status`

Invariants:

- an agent definition describes what kind of work may be attempted
- an agent never expands its own authority outside capability and policy references
- an agent may own many runs, but one run has one assigned agent

### Objective

A high-level delivery outcome requested by a human operator or trusted system.

Fields:

- `objective_id`
- `company_id`
- `title`
- `description`
- `requester_ref`
- `priority`
- `status`
- `source_ref`
- `created_at`

Invariants:

- an objective is decomposed into one or more work items
- objective completion is derived from work-item outcomes, not from free-form chat claims

### Work Item

A bounded executable slice compiled from an objective.

Fields:

- `work_item_id`
- `objective_id`
- `company_id`
- `title`
- `description`
- `kind`
- `scope_ref`
- `validation_contract_ref`
- `required_capability_ref`
- `approval_policy_ref`
- `status`
- `attempt_budget`
- `parent_work_item_id`

Invariants:

- one work item has one active owner at a time
- exclusive scope overlap is forbidden unless mediated by an explicit policy
- a work item may create many run attempts, but only one run may be active at a time
- the validation target must exist before execution starts

### Execution Packet

An immutable run input bundle frozen before execution.

Fields:

- `execution_packet_id`
- `work_item_id`
- `run_attempt`
- `assigned_agent_id`
- `context_bundle_ref`
- `tool_scope_ref`
- `artifact_inputs`
- `expected_result_schema_ref`
- `policy_snapshot_ref`
- `created_at`

Invariants:

- a run cannot start without a frozen execution packet
- packets are immutable after creation
- retries may reference prior attempts, but each retry receives a new packet with a new identifier

### Run

One concrete attempt to execute a work item under one frozen execution packet.

Fields:

- `run_id`
- `work_item_id`
- `execution_packet_id`
- `company_id`
- `assigned_agent_id`
- `attempt`
- `status`
- `started_at`
- `ended_at`
- `termination_reason`

Invariants:

- one run corresponds to exactly one execution packet
- a run is the only entity allowed to own effect results for a given attempt
- terminal run outcomes are explicit and typed

### Approval

A required human or policy gate.

Fields:

- `approval_id`
- `company_id`
- `work_item_id`
- `run_id`
- `approval_kind`
- `requested_action`
- `requested_by_ref`
- `decider_ref`
- `status`
- `decision_reason`
- `expires_at`

Invariants:

- an approval request refers to one bounded decision
- denied or expired approvals do not silently continue execution
- approvals do not mutate packets retroactively

### Artifact

A durable piece of evidence produced or consumed by runtime activity.

Fields:

- `artifact_id`
- `company_id`
- `producer_type`
- `producer_id`
- `artifact_kind`
- `storage_ref`
- `content_hash`
- `schema_ref`
- `created_at`

Invariants:

- every artifact has a producer
- artifacts are content-addressable or hash-verifiable
- result validation references artifacts, not implicit memory

## Supporting entities

### Claim Lease

Represents temporary exclusive ownership over a scope or artifact class.

Fields:

- `claim_id`
- `company_id`
- `work_item_id`
- `scope_ref`
- `holder_run_id`
- `lease_expires_at`
- `status`

Invariants:

- only one active exclusive claim may exist for a scope at a time
- lease expiry is an event, not a silent timeout hidden in memory

### Policy Reference

A versioned reference to the rules under which execution occurs.

Examples:

- capability policy
- approval policy
- retry policy
- projection policy

Invariant:

- a run always points to a stable policy snapshot, never to mutable global defaults

## Aggregate boundaries

### Objective aggregate

Owns objective state and links to its work items.

### Work-item aggregate

Owns work item lifecycle, active claim, and approval requirements.

### Run aggregate

Owns execution attempt lifecycle, packet reference, results, and termination reason.

### Approval aggregate

Owns one decision boundary from request to terminal decision.

### Artifact aggregate

Owns artifact metadata and provenance links.

## Relationship summary

- one `company` has many `agents`
- one `company` has many `objectives`
- one `objective` has many `work_items`
- one `work_item` has many `runs`
- one `run` has one `execution_packet`
- one `work_item` may require many `approvals`, but each request covers one decision
- `artifacts` may be attached to objectives, work items, runs, or approvals

## Deterministic invariants

- no execution starts without a work item, assigned agent, and execution packet
- no output continues the workflow unless it validates against the expected result contract
- no exclusive conflict resolves via last-write-wins
- no projection may redefine aggregate truth
- no entity status transition is valid unless backed by a typed event

## Explicit exclusions

These are not write-model entities:

- GitHub issues
- pull requests
- chat transcripts
- dashboards
- analytics counters

They are projections or supporting surfaces derived from runtime truth.
