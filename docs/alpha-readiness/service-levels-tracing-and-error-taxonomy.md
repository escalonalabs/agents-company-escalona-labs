# Service Levels, Tracing, And Error Taxonomy

## Purpose

Define the alpha operating language for health, latency, traceability, and failure handling so launches and incidents are evaluated against the same model.

## Alpha service levels

### Control plane availability

- monthly availability target: `99.5%`
- covers read APIs, operator timeline, pending approval views, and bounded control endpoints

### Command acceptance latency

- `p95 <= 5s` from authenticated operator request to accepted command id
- excludes approval wait time and downstream executor runtime

### Scheduler dispatch latency

- `p95 <= 30s` from `work_item.ready` to active lease or explicit blocked state
- `p99 <= 120s` during degraded mode

### GitHub projection freshness

- `p95 <= 60s` from committed ledger event to projected GitHub update
- `p99 <= 300s` before a drift or lag alert must open

### Approval visibility

- `p95 <= 15s` from `approval.requested` to operator-visible pending approval

## Tracing model

Every operator-visible action must remain traceable across:

- objective
- work item
- run
- approval
- execution packet
- GitHub projection event

## Required trace attributes

- `company_id`
- `objective_id`
- `work_item_id`
- `run_id`
- `approval_id` when applicable
- `execution_packet_id` when applicable
- `github_installation_id` when applicable
- `github_issue_number` when applicable
- `policy_snapshot_ref`
- `trace_outcome`

## Required span families

- planner compilation
- scheduler lease acquisition
- approval wait
- executor dispatch
- tool execution envelope validation
- projection synchronization
- drift detection
- memory extraction

## Error taxonomy

### Validation errors

- malformed commands
- invalid execution packet
- invalid task result
- schema mismatches during replay or projection rebuild

Retry rule:

- no automatic retry until the upstream payload changes

### Policy errors

- missing capability
- missing scope
- missing approval
- exceeded retry, budget, or concurrency cap

Retry rule:

- retry only after policy state changes

### Execution errors

- transient tool failure
- executor timeout
- unavailable dependency
- cancelled run

Retry rule:

- bounded retry by policy and failure class

### Projection errors

- GitHub write rejected
- GitHub object missing
- protected-field drift
- projection lag beyond freshness target

Retry rule:

- retry sync safely from ledger truth

### Security errors

- secret access denied
- unsigned or untrusted callback
- forbidden capability request
- audit log write failure

Retry rule:

- fail closed and escalate

## Severity model

- `sev0`: data loss, integrity break, or unsafe execution continuity
- `sev1`: alpha launch blocker or sustained SLO breach
- `sev2`: degraded but bounded operation with manual workaround
- `sev3`: local defect with no current user-facing breach

## Alpha alerts

- control plane availability burn alert
- scheduler dispatch latency alert
- projection freshness alert
- repeated `invalid_output` alert
- repeated drift alert on the same aggregate
- audit write failure alert

## Exit rule

Alpha readiness requires dashboarding and alerts to use this taxonomy directly. No incident or health report should invent a parallel vocabulary.
