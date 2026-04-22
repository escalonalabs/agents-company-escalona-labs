# Execution Packet And Fail-Closed Task Result

## Purpose

Define the immutable packet that starts a run and the result contract that prevents invalid or ambiguous output from triggering downstream work.

## Execution packet

Required fields:

- `execution_packet_id`
- `work_item_id`
- `run_id`
- `assigned_agent_id`
- `objective_context`
- `tool_allowlist`
- `scope_allowlist`
- `input_artifact_refs`
- `expected_result_schema_ref`
- `policy_snapshot_ref`
- `created_at`

Rules:

- packet is immutable
- packet is complete enough to execute without ambient chat state
- packet version is recorded for replay

## Task result contract

Required fields:

- `run_id`
- `execution_packet_id`
- `result_status`
- `result_schema_version`
- `artifact_refs`
- `summary`
- `structured_output`
- `failure_class`
- `validator_ref`

## Result status values

- `valid_success`
- `invalid_output`
- `transient_failure`
- `permanent_failure`
- `cancelled`

## Fail-closed rules

- missing required fields means `invalid_output`
- malformed structured output means `invalid_output`
- mismatched packet reference means `invalid_output`
- downstream scheduling only occurs from `valid_success`

## Why this matters

This contract is the hard stop that prevents loose or noisy agent output from automatically continuing the workflow.
