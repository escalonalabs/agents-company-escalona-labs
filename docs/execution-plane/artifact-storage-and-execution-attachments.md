# Artifact Storage And Execution Attachments

## Purpose

Define how execution artifacts are stored, linked, retained, and surfaced for replay, review, and memory extraction.

## Artifact classes

- stdout or stderr logs
- command transcripts
- JSON results
- screenshots
- downloaded files
- validation reports
- projection receipts

## Storage rules

- the canonical artifact metadata lives in the ledger or artifact index
- large binary content may live in blob storage referenced by durable URIs
- artifact hashes must be recorded for integrity

## Attachment rules

- each artifact must link to its producing run or validation step
- GitHub may expose links or summaries, but not become the only durable artifact store
- retention class must be declared per artifact kind

## Retention classes

- `ephemeral`
- `operational`
- `audit`
- `knowledge_candidate`

## Review rule

Any result that influences continuation must have artifact evidence sufficient for a reviewer to understand what happened.
