# Self-Hosted Operations

This repository now includes a minimal self-hosted base for M14 packaging
without changing the business runtime. The supported local path is:

- browser -> `control-web`
- `control-web` reverse proxy -> `control-plane`
- `github-app` -> `control-plane` internal API
- `control-plane` -> `postgres`
- optional local dependencies -> `minio` and `mailpit`

## Compose stack

Bring up the local stack:

```bash
docker compose up --build -d
```

Stop it:

```bash
docker compose down
```

Reset volumes:

```bash
docker compose down -v
```

Optional sample data:

```bash
docker compose --profile sample-data up control-plane-seed
```

The sample-data profile only runs the existing `db/seed` script. Skip it for a
clean first-operator bootstrap.

## Required environment variables

`docker compose` uses `.env` automatically if it exists. For local-only usage,
the defaults in [`docker-compose.yml`](../../docker-compose.yml) are enough to
boot, but replace all secrets before exposing the stack outside your machine.

### Control plane

| Variable | Purpose | Local default |
| --- | --- | --- |
| `AGENTS_COMPANY_NODE_ENV` | runtime mode | `production` |
| `AGENTS_COMPANY_APP_URL` | public operator UI origin for cookies/CORS | `http://localhost:8080` |
| `AGENTS_COMPANY_CONTROL_PLANE_PORT` | control-plane listen port inside container | `3000` |
| `AGENTS_COMPANY_DATABASE_URL` | Postgres connection string | `postgresql://agents_company:agents_company@postgres:5432/agents_company` |
| `AGENTS_COMPANY_STORAGE_ENDPOINT` | object storage endpoint | `http://minio:9000` |
| `AGENTS_COMPANY_STORAGE_REGION` | object storage region | `us-east-1` |
| `AGENTS_COMPANY_STORAGE_BUCKET` | object storage bucket name | `agents-company-local` |
| `AGENTS_COMPANY_STORAGE_ACCESS_KEY` | object storage credential | `minioadmin` |
| `AGENTS_COMPANY_STORAGE_SECRET_KEY` | object storage credential | `minioadmin` |
| `AGENTS_COMPANY_STORAGE_FORCE_PATH_STYLE` | S3 path-style toggle | `true` |
| `AGENTS_COMPANY_MAIL_SMTP_URL` | SMTP transport for invites/notifications | `smtp://mailpit:1025` |
| `AGENTS_COMPANY_MAIL_UI_URL` | operator-visible mail UI | `http://localhost:8025` |
| `AGENTS_COMPANY_SESSION_SECRET` | session signing boundary | `change-me-before-production` |
| `AGENTS_COMPANY_SESSION_TTL_HOURS` | operator session lifetime | `168` |
| `AGENTS_COMPANY_INVITATION_TTL_HOURS` | invitation expiry | `168` |
| `AGENTS_COMPANY_INTERNAL_API_TOKEN` | internal API auth between `github-app` and `control-plane` | `change-me-before-production` |

### GitHub App

| Variable | Purpose | Local default |
| --- | --- | --- |
| `AGENTS_COMPANY_GITHUB_APP_PORT` | GitHub App listen port inside container | `3001` |
| `AGENTS_COMPANY_CONTROL_PLANE_URL` | internal control-plane base URL | `http://control-plane:3000` |
| `AGENTS_COMPANY_INTERNAL_API_TOKEN` | shared internal token | `change-me-before-production` |
| `AGENTS_COMPANY_GITHUB_APP_ID` | GitHub App id | empty |
| `AGENTS_COMPANY_GITHUB_WEBHOOK_SECRET` | webhook signature secret | empty |
| `AGENTS_COMPANY_GITHUB_PRIVATE_KEY` | PEM private key with `\n` escaped line breaks if provided in one line | empty |
| `AGENTS_COMPANY_GITHUB_API_BASE_URL` | GitHub API base URL | `https://api.github.com` |

### Host port overrides

| Variable | Purpose | Local default |
| --- | --- | --- |
| `POSTGRES_HOST_PORT` | published Postgres port | `55432` |
| `MINIO_API_HOST_PORT` | published MinIO API port | `9000` |
| `MINIO_CONSOLE_HOST_PORT` | published MinIO console port | `9001` |
| `MAILPIT_SMTP_HOST_PORT` | published SMTP port | `1025` |
| `MAILPIT_UI_HOST_PORT` | published Mailpit UI port | `8025` |
| `CONTROL_PLANE_HOST_PORT` | published control-plane port | `3000` |
| `GITHUB_APP_HOST_PORT` | published GitHub App port | `3001` |
| `CONTROL_WEB_HOST_PORT` | published control-web port | `8080` |

## Bootstrap: first operator and first company

### Preferred path: control-web

1. Open `http://localhost:8080`.
2. On first launch, submit the bootstrap form. This calls `POST /auth/bootstrap`
   on `control-plane`.
3. After the first operator session is created, create the first company from
   the UI.
4. Invite additional operators from the company access section.

### API path with curl

Bootstrap the first operator:

```bash
curl -i \
  -c .cookies \
  -H 'content-type: application/json' \
  -d '{"email":"owner@example.com","password":"change-me-now","displayName":"First Operator"}' \
  http://localhost:3000/auth/bootstrap
```

Create the first company with the bootstrapped session:

```bash
curl -i \
  -b .cookies \
  -H 'content-type: application/json' \
  -d '{"slug":"acme","displayName":"Acme"}' \
  http://localhost:3000/companies
```

Check onboarding status:

```bash
curl -s -b .cookies http://localhost:3000/companies | jq
curl -s -b .cookies http://localhost:3000/companies/<company-id>/onboarding | jq
```

Invite another operator:

```bash
curl -i \
  -b .cookies \
  -H 'content-type: application/json' \
  -d '{"email":"operator@example.com","role":"operator"}' \
  http://localhost:3000/companies/<company-id>/invitations
```

The invited operator can preview or accept the invitation through:

- `GET /company-invitations/<token>/preview`
- `POST /company-invitations/accept`

## GitHub App flow

`github-app` is packaged and runnable even if the GitHub credentials are still
empty. Its `/health` endpoint reports `status: "degraded"` until all GitHub App
credentials and the control-plane internal transport are configured, and the
container healthcheck reflects that same readiness contract.

Once the GitHub App values are set, expose `http://localhost:3001/webhooks/github`
to GitHub and link the installation from the UI or via:

```bash
curl -i \
  -b .cookies \
  -H 'content-type: application/json' \
  -d '{"installationId":123,"accountLogin":"acme","repository":{"owner":"acme","name":"agents-company"}}' \
  http://localhost:3000/companies/<company-id>/github/installations
```

## Validation

Recommended validation sequence:

```bash
docker compose config
docker compose up --build -d
docker compose ps
curl -s http://localhost:3000/health | jq
curl -s http://localhost:3001/health | jq
curl -fsS http://localhost:9000/minio/health/live
curl -I http://localhost:8080
```

Expect `github-app` health to show `status: "ok"` only after
`AGENTS_COMPANY_GITHUB_APP_ID`, `AGENTS_COMPANY_GITHUB_PRIVATE_KEY`, and
`AGENTS_COMPANY_GITHUB_WEBHOOK_SECRET` are configured.

Automated compose validation:

```bash
pnpm smoke:self-hosted
```

For a clean-room bootstrap validation:

```bash
docker compose down -v
docker compose up --build -d
curl -s http://localhost:3000/auth/session | jq
```

## Helm foundation

The chart foundation lives under [`charts/agents-company`](../../charts/agents-company).
It packages the three app services and assumes external stateful dependencies
such as Postgres and object storage are provided by the target cluster.

Render the chart locally:

```bash
helm template agents-company ./charts/agents-company
```

Install or upgrade with explicit values:

```bash
helm upgrade --install agents-company ./charts/agents-company \
  --namespace agents-company \
  --create-namespace \
  -f my-values.yaml
```

Operational notes:

- The chart runs database migration as a Helm hook Job before install/upgrade.
- `control-plane` stays single-replica by default to avoid widening the local
  blast radius before a dedicated migration/promotion story exists.
- `control-web` keeps the same-origin proxy contract as Compose, so cookies and
  operator flows do not require runtime code changes.

## Metrics and scraping

Both backend services now expose Prometheus-compatible metrics:

- `control-plane`: `GET /metrics`
- `github-app`: `GET /metrics`

Quick local checks:

```bash
curl -s http://localhost:3000/metrics | head
curl -s http://localhost:3001/metrics | head
```

The Helm chart enables scrape annotations on the backend Services by default:

- `prometheus.io/scrape: "true"`
- `prometheus.io/path: /metrics`
- `prometheus.io/port: "3000"` or `"3001"`

Override or disable these via:

- `controlPlane.service.annotations`
- `githubApp.service.annotations`

Operational baseline for M15:

- scrape `control-plane` for ledger volume and auth readiness
- scrape `github-app` for accepted/rejected webhook counters
- pair these metrics with the existing `/health` JSON endpoints for operator
  diagnostics and release gating

## Backup and restore drill

The repository now ships compose-oriented Postgres backup and restore-drill
scripts:

```bash
pnpm ops:backup:postgres
pnpm ops:restore-drill:postgres
```

Behavior:

- `ops:backup:postgres` writes a compressed custom-format dump under
  `backups/postgres/` and validates the archive with `pg_restore --list`
- `ops:restore-drill:postgres` restores that dump into a temporary database
  named `agents_company_restore_drill` by default
- the drill prints restored counts for the core ledger tables:
  `companies`, `objectives`, `work_items`, `runs`, `approvals`
- the temporary restore database is dropped automatically unless
  `KEEP_RESTORE_DB=1`

Useful overrides:

- `POSTGRES_CONTAINER`
- `POSTGRES_USER`
- `POSTGRES_PASSWORD`
- `BACKUP_FILE`
- `BACKUP_DIR`
- `RESTORE_DRILL_DB`

Example:

```bash
BACKUP_DIR=/tmp/agents-company-backups pnpm ops:backup:postgres
BACKUP_FILE=/tmp/agents-company-backups/agents-company-postgres-20260422T223500Z.dump \
  RESTORE_DRILL_DB=agents_company_restore_verify \
  pnpm ops:restore-drill:postgres
```
