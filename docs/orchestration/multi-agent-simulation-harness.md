# Multi-Agent Simulation Harness

## Purpose

Define the simulation and failure-injection environment used to evaluate orchestration behavior before full implementation.

## Harness goals

- test contention and exclusive scope conflicts
- test retries and retry exhaustion
- test approval gates and delayed decisions
- test known deadlock or loop-like patterns
- prove that no-op handoff cycles do not self-sustain

## Required scenarios

### Shared-scope contention

Two or more work items compete for one exclusive scope.

Expected result:

- one wins the lease
- others wait or escalate
- no last-write-wins behavior

### Pending loop replay

Repeated “pending / verification pending / continue?” style transitions arrive with no new causal input.

Expected result:

- scheduler withholds redispatch
- system emits escalation or blocked outcome

### Approval latency

An approval request remains unresolved for a long period.

Expected result:

- work pauses safely
- unrelated work continues if independent

### Transient retry storm

Many retryable failures occur at once.

Expected result:

- retry budgets are enforced
- queues remain explainable
- no infinite churn

## Metrics

- queue wait time
- lease conflict rate
- duplicate dispatch suppression count
- no-op loop prevention count
- escalation rate

## Success condition

The simulation harness should make orchestration failure modes visible before production implementation depends on them.
