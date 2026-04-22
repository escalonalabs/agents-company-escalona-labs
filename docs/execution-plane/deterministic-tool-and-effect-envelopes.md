# Deterministic Tool And Effect Envelopes

## Purpose

Define the canonical request and response envelopes for tools and side effects so execution remains bounded, auditable, and replay-aware.

## Design rule

The kernel does not execute “whatever the agent wants.” It authorizes one bounded effect request and records one bounded effect result.

## Tool request envelope

Every tool invocation should carry:

- `tool_call_id`
- `run_id`
- `execution_packet_id`
- `tool_kind`
- `tool_name`
- `tool_version`
- `capability_ref`
- `scope_ref`
- `timeout_ms`
- `request_payload`
- `requested_at`

## Tool request rules

- every request is attributable to one run
- the request payload must be schema-valid before dispatch
- no hidden ambient parameters may be injected after authorization

## Effect envelope

Every side effect response should carry:

- `tool_call_id`
- `run_id`
- `effect_status`
- `started_at`
- `completed_at`
- `artifact_refs`
- `result_payload`
- `error_class`
- `error_message`

## Effect status values

- `succeeded`
- `failed_transient`
- `failed_permanent`
- `cancelled`
- `timed_out`

## Replay rule

During replay, envelopes are read as historical facts. Tools are not re-executed.

## Forbidden side channels

- reading secrets from undeclared environment state
- mutating request payloads after policy approval
- embedding critical effect results only in free-form logs
