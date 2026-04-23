# GA Runbook

This is the final go-live checklist for `M17`.

## Hard gates

The release is not GA-ready unless all of these are true:

- `main` is strongly protected
- `release/*` is protected for release candidates
- hosted and self-hosted docs are published
- support and release discipline are published
- staging and production rollout paths are documented
- rollback target is named before deployment

## Pre-launch verification

Run and capture:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm ops:validate:m15
pnpm release:evidence -- --version v0.1.0 --release-branch release/v0.1.0
```

Confirm the following operational assets are healthy:

- GitHub App installation is active
- production webhook endpoint is reachable
- backup and restore drill evidence exists
- alerting and dashboards are active
- TLS and domain routing are already in place
- secrets rotation path is documented

## Launch sequence

1. Cut or update the target `release/*` branch.
2. Confirm every required check is green.
3. Deploy to staging and run operator smoke tests.
4. Confirm webhook delivery and artifact flow in staging.
5. Review rollback target and launch ownership.
6. Deploy the same candidate to production.
7. Tag the production commit and publish release notes.

## Immediate post-launch watch

During the first launch window, watch:

- control-plane health
- GitHub webhook intake
- operator login and approval flows
- run execution latency
- artifact storage availability
- alert volume and error rate

## Rollback triggers

Rollback without delay if any of these occur:

- auth or permission regression
- ledger or projection corruption
- uncontrolled GitHub drift
- production health checks fail persistently
- self-hosted upgrade path breaks for the shipped version

## Seven-day stabilization window

Before declaring the release fully settled:

- no unresolved `SEV0`
- no unresolved `SEV1` outside the documented mitigation plan
- post-launch incidents have owners and due dates
- the next release branch is not cut until the current release is stable
