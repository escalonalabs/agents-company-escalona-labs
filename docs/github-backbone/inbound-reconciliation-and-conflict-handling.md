# Inbound Reconciliation And Conflict Handling

## Purpose

Define how human GitHub edits and external GitHub changes are interpreted, validated, and reconciled against the internal ledger without silent state corruption.

## Inbound principle

Inbound GitHub activity is not truth by default. It is either:

- accepted as an explicit human intent signal, or
- recorded as external drift requiring reconciliation

## Safe inbound actions

These may be mapped into kernel commands when policy allows:

- explicit approval comment or review from an authorized actor
- explicit cancellation request
- explicit unblock or reprioritization command
- explicit label changes on a small allowlist

## Non-authoritative actions

These do not directly mutate kernel truth:

- free-form issue title edits
- arbitrary body edits
- manual issue close without an allowed command path
- comment narration with no recognized command

These become reconciliation candidates or drift events.

## Reconciliation stages

1. receive webhook event
2. resolve target aggregate through metadata block
3. classify the action as allowed intent, benign divergence, or conflict
4. emit reconciliation or drift event
5. either apply a kernel command or re-project canonical truth back to GitHub

## Conflict classes

### Benign divergence

Pure formatting drift or non-authoritative prose changes.

Response:

- retain for audit
- optionally overwrite on next canonical projection

### Intent mismatch

Human attempted to express a valid intent through the wrong GitHub surface.

Response:

- record reconciliation note
- do not mutate kernel truth automatically

### Authoritative conflict

Human edit directly contradicts kernel truth on a protected field.

Response:

- emit drift
- re-project canonical state
- notify operators if repeated

### Missing linkage

GitHub object lacks metadata or references an unknown aggregate.

Response:

- quarantine as unlinked activity
- require manual reconcile

## Protected fields

Protected fields must not be directly trusted inbound:

- aggregate status
- approval outcome
- retry count
- run terminal state
- claim ownership

## Allowed command channels

For MVP, prefer explicit structured channels:

- slash-style issue comments
- GitHub review approval on linked PRs
- limited allowlist labels

## Conflict resolution rule

When GitHub and kernel disagree on protected state, the kernel wins and GitHub is repaired or annotated.
