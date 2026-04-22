# Planner / Compiler

## Purpose

Define how a high-level objective becomes a deterministic plan graph made of bounded work items that can be scheduled safely.

## Planner inputs

- objective
- company policy set
- available agent capabilities
- repository or artifact context
- operator constraints

## Planner outputs

- one `plan_graph`
- bounded `work_items`
- dependency edges
- validation contract for each work item
- required approval policy for each work item
- recommended concurrency groups

## Compiler stages

### 1. Objective normalization

Convert the objective into a stable problem statement with explicit scope, constraints, and success conditions.

### 2. Dependency extraction

Identify which parts of the work are:

- independent
- ordered
- approval-gated
- exclusive over the same scope

### 3. Work-item emission

Emit work items that are:

- small enough for one bounded owner
- meaningful enough to validate
- explicit about required artifacts and completion evidence

### 4. Plan graph validation

Reject or revise the plan if:

- dependencies are cyclic
- validation is undefined
- exclusive scope overlaps without a policy
- required capabilities do not exist

## Plan graph rules

- graph nodes are work items
- graph edges represent explicit prerequisites
- each node has one validation contract
- each node must declare whether it is parallelizable, exclusive, or approval-gated

## Planner anti-patterns

- creating handoff-only nodes with no deliverable
- creating nodes whose only output is another vague instruction
- creating parallel work over the same exclusive scope
- relying on agents to negotiate missing structure at runtime

## Replan triggers

- approval denial changes feasible path
- validation failure requires new structure
- dependency changes invalidate assumptions
- human override changes objective priority or scope

## Deterministic requirement

The same normalized objective plus the same planning context should produce the same plan graph or a traceable revision reason.
