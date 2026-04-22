# Capability Policy Engine

## Purpose

Define how capabilities, scopes, approvals, and permissions are evaluated before execution begins.

## Policy evaluation inputs

- agent capability profile
- execution packet
- work-item approval policy
- target scope
- tool request envelope

## Policy decision outputs

- `allowed`
- `allowed_with_approval`
- `denied`
- `denied_missing_scope`
- `denied_missing_capability`

## Policy dimensions

### Capability

Which class of action the agent may perform.

### Scope

Which repository, file set, domain, environment, or artifact class the action may touch.

### Approval

Whether the action is blocked until a bounded approval decision exists.

### Rate and budget

How many times or how broadly an action may execute.

## Enforcement rule

Policy is evaluated before dispatch. No executor may “try and see” if the system objects later.

## Audit rule

Every allow or deny decision must reference:

- policy snapshot
- capability reference
- scope reference
- approval requirement
