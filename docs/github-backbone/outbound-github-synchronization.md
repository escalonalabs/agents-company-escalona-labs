# Outbound GitHub Synchronization

## Purpose

Define how kernel events are projected into GitHub in a deterministic, observable, and idempotent way.

## Sync model

Outbound sync is driven from the kernel projection outbox, not from ad hoc direct API calls buried inside reducers.

## Delivery pipeline

1. canonical event enters the ledger
2. projection rule determines whether GitHub should be updated
3. one outbox delivery is enqueued with delivery key and source event reference
4. GitHub worker performs the API call
5. result is recorded as `projection.applied` or `projection.failed`

## Delivery key

Each outbound delivery must include an idempotency-friendly key built from:

- `projection_name`
- `aggregate_id`
- `source_event_id`
- `target_github_object`
- `action_type`

## Outbound action types

- create issue
- update issue body
- sync labels
- add comment
- create or update check run
- close issue
- reopen issue
- add milestone link
- post drift note

## Deterministic sync rules

- one source event may emit many projection deliveries, but each delivery key is unique
- repeated processing of the same source event must not create duplicate comments or duplicate issues
- comment templates and metadata blocks must be versioned

## Comment policy

Use comments for:

- run started
- run blocked
- approval requested
- validation failed
- drift detected

Do not use comments as the only machine-readable state representation.

## Check-run policy

Use checks for:

- machine-verifiable execution status
- validation status
- artifact links

Checks should summarize the run and link back to the work-item issue.

## Retry policy

- transient GitHub API failures retry through the outbox with bounded backoff
- permanent mapping or permission failures do not spin forever; they surface as drift or operator action items

## Observability

Every delivery should record:

- source event id
- GitHub object id
- delivery key
- attempt count
- last error if failed
- applied timestamp

## Forbidden patterns

- reducers calling GitHub APIs directly
- using GitHub response data as the new source of runtime truth
- posting duplicate comments for the same source event
