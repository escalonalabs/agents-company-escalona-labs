# ADR 0001: GitHub-First Operating Model

## Status

Accepted

## Context

The project needs one durable progress system that can coordinate humans, subagents, backlog, and delivery review without leaving state scattered across chat sessions.

## Decision

GitHub is the primary system for backlog, progress tracking, issue ownership, milestone management, and pull request review.

## Consequences

- Implementation work is discoverable and auditable
- Subagents can anchor their work to stable issues
- The runtime kernel still keeps its own deterministic operational ledger
- Chat does not become the long-term source of record

