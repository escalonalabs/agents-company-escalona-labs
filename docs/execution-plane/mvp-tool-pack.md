# MVP Tool Pack

## Purpose

Define the smallest useful, policy-aware tool set that supports the MVP execution loops.

## MVP tools

### HTTP read/write

Use for API interaction where domain allowlists exist.

### Shell command runner

Use for bounded automation and local development workflows.

### Browser interaction

Use for authenticated navigation, evidence capture, and UI verification.

### File and artifact operations

Use for reading, writing, hashing, and attaching durable outputs within declared scope.

### Internal control actions

Use for projection repair, reconciliation tasks, and test or simulation helpers.

## Exclusions from MVP

- unrestricted package installation
- arbitrary infrastructure mutation
- unrestricted secret management
- unconstrained desktop automation outside explicitly approved surfaces

## Selection rule

Each tool in the MVP pack must satisfy:

- it supports a known MVP workflow
- it has a bounded policy model
- it returns typed results
- it can be explained and audited
