# Retrieval Policy And Invalidation

## Purpose

Define what memory may be retrieved, when it is valid, and how stale or invalid memory is rejected.

## Retrieval rules

- retrieval is explicit and policy-aware
- memory returned to a run must declare source, freshness, and confidence
- no memory may override execution packet facts or current ledger truth

## Retrieval filters

- company scope
- objective or domain relevance
- retention class
- freshness window
- confidence threshold

## Invalidation triggers

- contradicted by newer evidence
- superseded by policy or architecture change
- expired by retention window
- marked unsafe by contamination review

## Invalidation outcomes

- `expired`
- `superseded`
- `revoked`
- `quarantined`

## Safe retrieval rule

If retrieval confidence is low or invalidation status is uncertain, the memory should be withheld rather than injected optimistically.
