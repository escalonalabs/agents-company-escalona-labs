# Build Mode Casi Libre

## Purpose

Capture the temporary GitHub operating posture used during heavy implementation from `M8` through `M15`.

## Rules

- `main` may accept direct pushes
- pull requests are optional during active construction
- milestone epics, ADRs, incidents, blockers, and releases must still be written into GitHub
- CI continues to run, but branch protection does not block delivery during this mode

## Exit path

- `M16` restores protection for release candidates
- `M17` restores strong protection for `main`

## Why this exists

The project is moving from architecture-only artifacts into a full runtime build. Temporary GitHub friction reduction is intentional so the repository can absorb large foundational changes without repeatedly stalling on review mechanics.
