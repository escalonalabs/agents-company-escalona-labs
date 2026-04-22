# Recall And Contamination Evaluation

## Purpose

Define the evaluation suite that measures whether memory improves execution instead of polluting it.

## Core metrics

- recall usefulness
- stale retrieval rate
- contamination rate
- provenance completeness
- override frequency due to bad memory

## Required scenarios

### Helpful recall

Memory supplies a real constraint or convention that improves planning or execution.

### Stale recall

Old knowledge is retrieved after being superseded.

Expected result:

- retrieval should be blocked or downgraded

### Contaminated recall

Unverified or speculative memory appears relevant.

Expected result:

- policy or confidence filter rejects it

### Provenance break

Memory cannot be traced back to source evidence.

Expected result:

- knowledge item is quarantined or rejected

## Success rule

Memory is only a success if it raises execution quality without increasing hidden-state risk.
