# Executor Boundaries

## Purpose

Define the interfaces and boundaries between intent, policy, and actual side-effect delivery.

## Execution architecture

The execution plane is split into:

- intent creation in the kernel or scheduler
- policy evaluation in the capability engine
- effect dispatch through specialized executors
- result capture and validation before continuation

## Executor classes

### HTTP executor

For deterministic web requests to allowed endpoints.

Boundary:

- receives pre-authorized payload only
- returns typed response metadata and artifacts

### Shell executor

For bounded local or remote command execution.

Boundary:

- command must be explicitly declared
- working directory and environment allowlist must be frozen

### Browser executor

For page navigation, DOM interaction, screenshot capture, and browser-linked evidence.

Boundary:

- navigation domains must be policy-allowed
- recorded outputs include screenshots, links, and interaction trace

### Internal executor

For non-external runtime actions such as projection repair, queue mutation, or synthetic evaluation tasks.

Boundary:

- still emits typed effect envelopes
- does not bypass normal result validation

## Shared boundary rules

- executors never decide whether a tool call is allowed
- executors never redefine business state transitions
- executors never continue downstream work on their own
- every executor returns through the same effect envelope contract
