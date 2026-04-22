# GitHub-First Delivery

## Goal

Use GitHub as the default system for progress, backlog, task ownership, and delivery traceability.

## Execution rules

- Work begins from an issue or epic
- Pull requests reference the issue they advance
- Every issue carries labels, milestone, and validation intent
- Blockers are written back to the issue, never left implicit
- Chat is coordination support, not source of record

## Subagent operating rule

- Each subagent works from an explicit issue
- Each subagent owns a bounded slice
- Any unresolved edge case is returned to GitHub with evidence
- No subagent closes a task without verification evidence

## Review rules

- Findings before summaries
- Risk and regression review before style review
- Evidence before completion claims
- One issue, one decision boundary

## Temporary build mode

- During `M8` through `M15`, `main` may accept direct pushes so implementation velocity is not gated by review friction
- GitHub still remains the source of truth for milestone epics, ADRs, blockers, incidents, and releases
- `M16` restores protection on release candidates
- `M17` restores strong protection on `main`
