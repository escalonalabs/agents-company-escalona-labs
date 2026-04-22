# Support and On-Call

This document defines the minimum support discipline required for GA.

## Ownership model

- Escalona Labs owns the hosted production service
- self-hosted customers own their infrastructure, networking, and local secrets
- Escalona Labs owns the application behavior, release artifacts, and supported
  upgrade path

## Severity levels

- `SEV0`: security event, irreversible data risk, or total service outage
- `SEV1`: major customer-facing degradation without safe workaround
- `SEV2`: partial degradation or time-bounded workaround required
- `SEV3`: minor defect, documentation gap, or low-impact operator issue

## Response targets

- `SEV0`: acknowledge immediately, operator bridge opened in 15 minutes or less
- `SEV1`: acknowledge in 30 minutes or less
- `SEV2`: acknowledge in 4 business hours or less
- `SEV3`: route through normal backlog or support flow

## Hosted production responsibilities

Hosted on-call covers:

- control-plane availability
- GitHub App ingress and webhook delivery
- operator login and invitation flow
- ledger, storage, and artifact availability
- release rollback coordination

Hosted on-call does not close incidents without:

- explicit customer impact statement
- suspected root cause
- mitigation or rollback evidence
- follow-up action owner

## Self-hosted support boundary

Supported self-hosted cases:

- clean install using the official Helm chart
- documented upgrade path
- product behavior that reproduces on a supported deployment

Out of scope without separate agreement:

- custom Kubernetes distributions with unsupported deviations
- customer-modified charts or images
- private forks and unreviewed patches

## Incident command flow

1. Declare severity and impacted surface.
2. Assign incident commander.
3. Assign operations owner and product owner.
4. Freeze unrelated deploys.
5. Decide mitigation path:
   - rollback
   - degrade safely
   - fix forward
6. Publish status updates on a fixed cadence until recovery.

## Evidence required per incident

- affected release or commit
- timeline of detection, acknowledgement, mitigation, and resolution
- impacted companies or deployment scope
- logs, traces, or replay evidence that justify the conclusion
- explicit follow-up items for prevention

## Escalation boundaries

- security or credential exposure escalates immediately to security review
- data integrity suspicion escalates immediately to rollback review
- repeated GitHub drift or replay failures escalate to release stop
- support load beyond operator capacity escalates to launch hold for the next
  release
