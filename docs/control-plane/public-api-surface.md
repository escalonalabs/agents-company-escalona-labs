# Public API Surface

## Purpose

Define the public control-plane API for companies, agents, objectives, runs, approvals, and operator actions.

## API principles

- public API reflects domain aggregates and projections without exposing reducer internals
- operator actions are explicit commands, not generic patch endpoints
- every response should include stable identifiers and timestamps

## Core resource groups

### Companies

- list companies
- get company
- create company
- get company status and projection health

### Agents

- list agents in company
- get agent definition
- get agent capability profile

### Objectives and work items

- create objective
- list objectives
- view objective graph
- view work items for an objective

### Runs and approvals

- list runs
- get run timeline
- list pending approvals
- submit approval decision

### Control actions

- cancel work item
- requeue eligible work item
- reprioritize objective
- request planner revision

## Response shape rule

Responses should separate:

- canonical aggregate data
- projection or health metadata
- linked artifacts and references

## Non-goals

- expose internal ledger tables directly
- accept arbitrary mutation patches on protected fields
