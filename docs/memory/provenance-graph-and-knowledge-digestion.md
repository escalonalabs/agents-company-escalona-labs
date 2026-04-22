# Provenance Graph And Knowledge Digestion

## Purpose

Define how raw evidence becomes reusable knowledge while preserving traceability.

## Provenance graph nodes

- ledger events
- artifacts
- validation outcomes
- GitHub decisions
- memory candidates
- approved knowledge items

## Provenance graph edges

- `derived_from`
- `validated_by`
- `supersedes`
- `invalidates`
- `approved_by`

## Digestion pipeline

1. gather evidence-backed candidates
2. normalize and summarize
3. attach provenance links
4. assign confidence and retention class
5. promote, reject, or quarantine

## Knowledge rule

Every durable knowledge item must answer:

- what evidence created it
- who or what validated it
- when it becomes stale

## Anti-patterns

- orphaned memory with no evidence trail
- summaries that drop critical uncertainty
- promoting GitHub commentary to knowledge without validation
