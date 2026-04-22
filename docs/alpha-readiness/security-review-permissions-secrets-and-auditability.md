# Security Review For Permissions, Secrets, And Auditability

## Purpose

Close the alpha security review for the surfaces most likely to create irreversible damage: permissions, secrets, and auditability.

## Review scope

- GitHub App permissions and webhook handling
- control-plane operator actions
- executor capability and scope enforcement
- secret storage and token handling
- audit trail completeness for approvals, dispatch, and projection

## Trust boundaries

- operator browser to control plane
- control plane to ledger and projections
- control plane to GitHub App installation tokens
- runtime to executor boundaries
- executor to external tools

## Permissions review

### Accepted alpha posture

- GitHub App holds only the minimum repository permissions already defined in the GitHub Backbone docs
- operator actions enter the kernel as explicit commands
- executor access is derived from capability, scope, and approval state, not prompt text
- installation tokens are scoped to installed repositories only

### Rejected alpha posture

- no personal access token fallback
- no executor-side self-escalation
- no broad administration write on GitHub
- no ambient shell or browser access outside the execution packet and policy snapshot

## Secrets handling review

- app private key stays in server-side secret storage only
- installation tokens stay short-lived and are never persisted as durable plaintext state
- executor secrets must be injected per run and referenced in audit metadata without writing secret material to logs or artifacts
- secret rotation events must invalidate cached policy or connection state before the next dispatch

## Auditability review

Every alpha-critical decision must produce an auditable record for:

- command acceptance
- approval request and decision
- lease acquisition and expiry
- execution packet creation
- task result validation
- GitHub projection write or failure
- drift detection and operator override

## Required evidence fields

- actor type
- actor identifier
- target aggregate
- policy snapshot reference
- before and after status summary
- linked artifact or GitHub reference when applicable
- timestamp and correlation identifiers

## Residual risks accepted for alpha

- replay gate is still contract-first rather than reducer-backed
- GitHub remains a high-value external dependency for the human operating path
- human review can still become a bottleneck even when the runtime behaves correctly

## Alpha blockers

Alpha is blocked if any of these remain true:

- any runtime path still depends on a user PAT
- any executor path can run outside explicit capability and scope policy
- any approval or override action is not auditable
- any projection failure can mutate runtime truth silently

## Review conclusion

Alpha may proceed only with fail-closed policy enforcement, server-side secret custody, and complete audit coverage for operator and runtime control actions.
