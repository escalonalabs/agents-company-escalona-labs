# Clean-Room Policy And Provenance Checklist

## Purpose

This repository is built under a strict clean-room rule. External products, codebases, prompts, repos, and papers may inform requirements or constraints, but implementation in this repository must be authored here from scratch.

## Allowed inputs

- high-level product requirements
- public documentation, specs, and standards
- architectural lessons learned from prior systems
- problem statements, failure patterns, and user pain points
- original design documents, ADRs, benchmarks, and test cases written for this repository

## Forbidden inputs

- copying source code, tests, prompts, assets, or templates from third-party or legacy products
- porting code through translation, paraphrase, or superficial renaming
- recreating proprietary UX text or implementation structure line by line
- using external repos as a hidden starter kit while claiming the result is original

## Working rule

Inspiration may shape what we build. It must not determine the literal code, file structure, or product wording we paste into this repository.

## Required provenance posture

When a change is proposed, the author should be able to answer:

- what requirement or problem this change solves
- what original document, issue, or ADR inside this repository justified it
- what external ideas informed the design at a conceptual level
- why the final implementation is original to this repository

## Contributor checklist

Before opening or merging a change, confirm:

- the work traces back to a GitHub issue, ADR, or repository-owned plan
- no external code or protected assets were copied into the branch
- names, comments, and docs were written freshly for Escalona Labs
- any outside inspiration is described as influence, not imported implementation
- any generated artifacts were reviewed for accidental carryover of third-party identifiers

## Review checklist

Reviewers should challenge:

- suspiciously familiar file structure or wording
- copied tests, comments, or naming from external systems
- assets or prompts with unclear origin
- changes that cannot explain their repository-local source of truth

## Escalation rule

If provenance is unclear, the change stops. The default action is to rewrite or remove the questionable material rather than argue it through.

## Relationship to licensing

The repository license governs how others may use this repository. The clean-room policy governs how this repository itself is authored.
