# GitHub App Authentication And Permissions

## Purpose

Define the installation model, token flow, and least-privilege permissions for the GitHub App that projects kernel truth into GitHub and accepts safe inbound operator intent.

## Installation model

- one GitHub App owned by Escalona Labs
- installation occurs at organization or user-account scope
- each company stores the GitHub installation reference, not a personal access token

## Authentication flow

1. control plane redirects operator to install the GitHub App
2. installation identifier is stored against the company
3. the backend signs a short-lived JWT with the app private key
4. the backend exchanges the JWT for an installation access token
5. the installation token is used for GitHub API calls until expiry

## Secret handling

- private key stored only in server-side secret storage
- installation tokens are short-lived and never stored in plaintext long-term
- no user PAT should be required for runtime projection

## Minimum repository permissions

### Required

- `metadata: read`
- `issues: read/write`
- `pull_requests: read/write`
- `checks: read/write`
- `contents: read`

### Optional later

- `actions: read`
- `members: read`

### Not required for MVP

- code scanning write
- secrets write
- administration write

## Webhook subscriptions

- `issues`
- `issue_comment`
- `pull_request`
- `pull_request_review`
- `check_run`
- `check_suite`
- `installation`
- `installation_repositories`
- `repository`

## Permission posture

- write only where human-facing projection requires it
- read inbound events broadly enough to detect drift and human intent
- avoid administration scope unless a later milestone truly needs branch or repository mutation

## Token rules

- installation token scoped to the installed repositories only
- token refresh handled by backend on demand
- token expiry and failure become integration events, not hidden runtime exceptions

## Failure boundaries

- missing installation blocks projection for that company, not the whole platform
- missing write permission triggers drift or projection failure events
- the app must never fall back to a broader credential silently
