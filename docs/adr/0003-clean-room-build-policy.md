# ADR 0003: Clean-Room Build Policy

## Status

Accepted

## Context

The platform is being rebuilt from first principles with new branding and a new coordination kernel.

## Decision

This repository implements original code only. External systems may inform requirements, constraints, and useful concepts, but implementation must be authored here from scratch.

## Consequences

- Architecture and behavior can evolve without imported product debt
- Provenance stays simple and reviewable
- Design documents must be strong enough to replace copy-based shortcuts

