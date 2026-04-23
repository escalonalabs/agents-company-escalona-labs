# Release Train

This document defines the `M17` release discipline for hosted and self-hosted
delivery.

## Branch model

- `main` is the GA branch and stays strongly protected
- `release/*` is used for release candidates and stabilization
- feature or fix branches merge by pull request only

## Protection baseline

The required checks for `main` and `release/*` are:

- `quality`
- `ops-validation`
- `bootstrap-smoke`
- `integration-smokes`
- `self-hosted-smoke`
- `repo-guardrails`
- `dependency-review`
- `secret-scan`
- `replay-regression`

Both protected branch surfaces also require:

- pull request flow
- one approving review
- `CODEOWNERS`
- resolved review threads
- no deletion
- no non-fast-forward updates

## Release cadence

- cut a `release/<version-or-date>` branch from `main`
- stabilize only the scoped fixes required for the candidate
- deploy the candidate to staging first
- promote to production only after the GA runbook gates pass

## Candidate flow

1. Cut `release/<name>` from the latest green `main`.
2. Open a tracking issue or release note draft that lists:
   - target version
   - included objectives
   - open risks
   - rollback target
3. Merge only candidate-fix pull requests into `release/*`.
4. Re-run the full required check set on every candidate update.
5. Run the operational validation sequence:
   - staging deploy
   - webhook replay check
   - backup and restore drill confirmation
   - operator smoke through `control-web`
   - self-hosted install or upgrade smoke
6. Generate the release evidence bundle from the candidate branch.
7. Tag the approved commit with an immutable semver tag and publish the release artifact set.

Mutable aliases such as `staging` or `production` are not release artifacts.
Staging and production values files must point to immutable semver tags only.

## Hotfix policy

- critical production fixes branch from the active production tag or release
  branch, not from stale local state
- every hotfix must be merged back into `main`
- every hotfix must update release notes and incident references

## Rollback policy

Roll back immediately if any of these conditions hold:

- runtime integrity or ledger correctness is at risk
- approval flow or auth boundaries regress
- GitHub sync corrupts or drifts beyond the allowed recovery path
- hosted production health or latency leaves the agreed alert envelope

Rollback uses the last known-good release tag and its matching Helm values. Do
not improvise rollback targets during the incident.

## Exit criteria for a GA release

- all required checks are green
- staging validation is complete
- production deployment plan and rollback target are written down
- support/on-call owner is assigned
- incident channel and launch commander are named
- hosted and self-hosted notes are published with the release
