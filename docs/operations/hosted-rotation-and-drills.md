# Hosted Rotation and Drills

This document turns the hosted `M15` to `M18` operational promises into a
repeatable checklist.

## Secrets that must rotate

- session secret for `control-plane`
- internal API token shared between `control-plane` and `github-app`
- GitHub App webhook secret
- GitHub App private key
- outbound mail credentials
- database password stored in the hosted runtime secret

## Rotation cadence

- session and internal API secrets: every 90 days or immediately after exposure
- GitHub webhook secret: every 90 days or after webhook validation failure
- GitHub App private key: every 90 days or immediately after suspected leakage
- mail credentials: every 180 days or after provider incident
- database password: every 180 days and before major compliance reviews

## Hosted rotation procedure

1. Generate the new secret material outside the cluster.
2. Update the AWS Secrets Manager runtime secret.
3. Trigger a staged rollout in staging first.
4. Confirm `/health`, `/metrics`, and webhook delivery stay green.
5. Promote the same change to production.
6. Capture the rotation timestamp, owner, and validation evidence in the active
   release evidence folder.

## Reliability drills that must exist before a cutover

- Postgres backup drill
- Postgres restore drill
- self-hosted compose recovery drill
- GitHub webhook replay drill
- release rollback drill using the last known-good immutable tag

## Required evidence per drill

- the exact release tag under test
- operator or incident owner
- start and end timestamps
- commands or automation path used
- observed outcome
- rollback or remediation notes if the drill exposed a gap

## Release artifact location

Every production candidate stores its evidence under:

`artifacts/releases/<tag>/`

At minimum that folder must contain:

- `readiness.json`
- `SUMMARY.md`
- a note or attachment reference for any hosted drill executed outside the repo

## Cutover rule

No hosted cutover is approved if any required rotation or drill is missing,
stale, or only described verbally.
