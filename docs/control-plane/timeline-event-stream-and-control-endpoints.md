# Timeline, Event Stream, And Control Endpoints

## Purpose

Define the backend contracts that let operators inspect runtime state and perform bounded control actions.

## Timeline view

The timeline is a query surface over:

- runs
- approvals
- claims
- projection events
- drift events

## Event stream

Provide a filtered stream of operator-relevant events with:

- `event_id`
- `occurred_at`
- `aggregate_type`
- `aggregate_id`
- `event_type`
- `summary`
- `severity`

## Control endpoints

- `POST /approvals/{id}/grant`
- `POST /approvals/{id}/deny`
- `POST /work-items/{id}/cancel`
- `POST /work-items/{id}/requeue`
- `POST /objectives/{id}/replan`

## Backend rule

Control endpoints issue commands into the kernel; they do not mutate persisted state directly.
