# Product Charter

## Product identity

- Editorial name: `Agents Company by Escalona Labs`
- Product short name: `Agents Company`
- Technical short name: `agents-company`

## Mission

Build a deterministic company-of-agents platform that lets humans plan, supervise, and audit complex agent work through GitHub without turning chat transcripts into the system of record.

## Problem statement

Current agent teams fail in predictable ways:

- coordination drifts into repetitive conversational loops
- execution state gets mixed with human discussion
- continuity depends on fragile transcripts instead of durable artifacts
- humans cannot easily tell what is blocked, safe, or actually complete

Agents Company exists to separate progress from chatter, execution from narration, and deterministic runtime truth from human collaboration surfaces.

## Product thesis

The platform wins when it combines two layers cleanly:

1. An internal deterministic kernel that owns execution state, replay, approvals, leases, and fail-closed transitions.
2. A GitHub-first operating model that projects work into issues, pull requests, comments, checks, and milestones for human coordination.

GitHub is the human progress layer. It is not the runtime ledger.

## Primary users

### Founder-operator

Needs one place to see what agents are doing, what is blocked, what needs approval, and what shipped.

### Platform builder

Needs strong contracts, replayability, and clean seams to evolve the kernel without rewriting the product surface.

### Human reviewer

Needs evidence, not long chat transcripts, in order to review output and approve or reject work safely.

### Specialized subagent

Needs bounded tasks, stable context, and unambiguous ownership instead of open-ended conversational orchestration.

## MVP scope

### In scope

- deterministic kernel contracts for objectives, work items, runs, approvals, artifacts, and replay
- GitHub-first backlog, milestone, issue, and PR operating model
- company orchestration semantics with explicit leases, retries, and approval boundaries
- execution packet and task-result contracts that fail closed
- memory and provenance design strong enough for evaluation and later implementation
- control-plane foundations for operator timeline, drift awareness, and first-company bootstrap

### Out of scope for MVP

- marketplace dynamics, autonomous budgeting, or internal token economies
- general-purpose open-ended social chat between agents
- last-write-wins collaboration over exclusive artifacts
- full enterprise packaging, billing, or multi-tenant SaaS polish
- broad third-party ecosystem expansion before kernel and GitHub projection are stable

## Non-goals

- replicate the old platform behavior under a new name
- maximize the raw number of active agents at the expense of clarity
- hide uncertainty behind optimistic automation
- make GitHub the runtime source of truth

## Product principles

- Determinism before convenience
- Evidence before continuity
- GitHub-first for humans, internal ledger for runtime truth
- Fail closed instead of guessing
- One bounded owner for each meaningful slice of work
- Naming and brand consistency from day one
- Clean-room implementation only

## Success criteria for M0 to M2

- a new contributor can understand the backlog and operating model from the repo alone
- core architectural terms have one shared meaning
- foundation decisions do not need to be renamed or re-argued in M1 and M2
- GitHub and kernel responsibilities stay clearly separated

## Glossary

### Company

A configured operating unit composed of humans, agents, policies, and delivery surfaces.

### Objective

A high-level business or delivery outcome compiled into executable work.

### Work item

A bounded unit of planned work with one owner, explicit validation intent, and stable lifecycle.

### Run

One concrete execution attempt for a work item under a frozen packet and deterministic rules.

### Execution packet

An immutable input envelope that freezes context, permissions, tools, and expected result shape for a run.

### Approval

A human or policy-gated decision required before a work item may continue across a control boundary.

### Artifact

Any durable output produced or consumed by the system, including code, logs, attachments, docs, and evaluation evidence.

### Projection

A human-facing representation of internal runtime state in GitHub or other operator surfaces.

### Drift

A detectable mismatch between the internal ledger and an external projection such as GitHub.

### Replay

Deterministic reconstruction of prior runtime behavior from ledgered events and frozen inputs.
