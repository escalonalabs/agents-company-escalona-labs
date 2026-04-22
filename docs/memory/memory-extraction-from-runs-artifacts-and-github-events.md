# Memory Extraction From Runs, Artifacts, And GitHub Events

## Purpose

Define how durable knowledge is extracted from execution traces, artifacts, and GitHub activity.

## Extractable sources

- successful run outputs
- validation reports
- approval outcomes
- repeated failure patterns
- GitHub issue or PR decisions with durable relevance

## Extraction rules

- extraction is a separate step from execution
- only evidence-backed material may become reusable memory
- conversational noise and unverified speculation are not memory candidates

## Candidate classes

- coding or workflow conventions
- recurring integration constraints
- approved operator preferences
- repeated failure signatures

## Non-candidates

- one-off transient errors
- speculative explanations
- informal chat fragments with no linked artifact or event

## Extraction output

Each memory candidate should include:

- `memory_candidate_id`
- source event or artifact refs
- summary
- candidate class
- confidence
- retention class

## Promotion rule

Nothing becomes durable knowledge until it survives review or validation policy appropriate to its risk.
