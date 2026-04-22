# Kernel-To-GitHub Mapping

## Purpose

Define how deterministic kernel truth projects into GitHub issues, milestones, comments, checks, and metadata without turning GitHub into the write authority.

## Mapping principles

- the kernel owns truth; GitHub owns human readability
- every GitHub artifact must map back to a stable kernel identifier
- GitHub state may suggest intent, but it does not silently mutate runtime truth
- projections must be idempotent and rebuildable

## Canonical object mapping

### Objective

Projected as:

- one GitHub issue labeled `type:epic`
- milestone association when needed for release planning

GitHub fields:

- issue title mirrors objective title
- issue body contains objective summary and machine-readable metadata block
- labels carry planning signals such as priority, area, and track

### Work item

Projected as:

- one GitHub issue

GitHub fields:

- issue title mirrors work item title
- issue body includes bounded description, validation target, and metadata block
- labels mirror work-item classification and operator-visible state

### Approval

Projected as:

- issue comment thread on the work item
- optional check run summary on the related PR or issue-linked commit

Rule:

- approval status may be visible in GitHub, but the canonical approval aggregate remains in the kernel

### Run

Projected as:

- issue comments for narrative checkpoints
- check runs for machine-verifiable execution status

Rule:

- GitHub never stores run truth as the only source of status

### Artifact

Projected as:

- issue comment attachments, links, or check-run summaries

Rule:

- GitHub stores references to artifact locations, not the only copy of the artifact when durability matters

## GitHub surfaces by responsibility

### Issues

Used for:

- objective and work-item identity
- human-readable status
- validation intent
- blockers and decisions

### Milestones

Used for:

- roadmap grouping
- high-level planning cadence

### Labels

Used for:

- type
- area
- priority
- readiness or blocked state
- track membership

### Comments

Used for:

- run narration
- approval requests
- reconciliation notes
- drift evidence

### Check runs

Used for:

- execution progress summaries
- validation pass/fail surfaces
- machine-oriented status tied to commits or PRs

## Required metadata block

Each projected issue should contain a hidden metadata block with:

- `projection_version`
- `company_id`
- `aggregate_type`
- `aggregate_id`
- `source_event_id`
- `projection_delivery_id`

Purpose:

- allow deterministic reconciliation without parsing free-form prose

## Example mapping summary

- `objective` -> epic issue
- `work_item` -> issue
- `run` -> comment thread plus check run
- `approval` -> comment plus status summary
- `artifact` -> linked evidence

## What GitHub must never own

- aggregate sequence numbers
- replay truth
- retry authority
- approval authority after the kernel has recorded a denial or expiry
- exclusive claim resolution

## Operator clarity rules

- titles and labels should stay human-readable
- machine metadata should be hidden or clearly separated from prose
- one work item should not project into multiple live issues unless explicitly split by the kernel
