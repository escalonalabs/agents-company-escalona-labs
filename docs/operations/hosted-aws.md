# Hosted AWS Operations

This is the `M15` hosted deployment contract for Escalona Labs-managed AWS.

## Hosted target

- Kubernetes: EKS
- Database: RDS Postgres
- Object storage: S3
- Mail transport: SES SMTP or an equivalent SMTP endpoint
- Runtime secret source: AWS Secrets Manager
- Kubernetes secret sync: External Secrets Operator

## Deployment contract

Hosted staging and production use the same application chart:

- [`charts/agents-company/values-staging.yaml`](../../charts/agents-company/values-staging.yaml)
- [`charts/agents-company/values-production.yaml`](../../charts/agents-company/values-production.yaml)

Those values assume:

- Helm release name: `agents-company`
- `fullnameOverride: agents-company`
- runtime secret names:
  - `agents-company-staging-runtime`
  - `agents-company-production-runtime`
- runtime service accounts:
  - `agents-company-control-plane`
  - `agents-company-github-app`
- `ExternalSecret` backed by a cluster-scoped secret store named
  `aws-secretsmanager`

If you change any of those coordinates, update the Terraform variables and Helm
values together before rollout.

## Bootstrap sequence

1. Provision AWS base infrastructure with Terraform under
   [`infra/aws`](../../infra/aws).
2. Install External Secrets Operator and configure a `ClusterSecretStore`
   capable of reading from AWS Secrets Manager.
3. Apply Terraform and capture:
   - `runtime_irsa_role_arn`
   - `helm_runtime_secret_name`
   - `helm_values_hint.runtime_secret_remote_key`
   - `ecr_repositories`
4. Build and push the three images to the ECR repositories Terraform created.
5. Update the staged or production Helm values with the actual ECR account id if
   it differs from the examples.
6. Deploy the Helm chart into the target namespace.

## GitHub webhook path

Hosted ingress is intentionally single-origin through `control-web`.
`/webhooks/github` is proxied by the NGINX layer to `github-app`, so the public
webhook URL is:

- staging: `https://staging.agents-company.escalonalabs.com/webhooks/github`
- production: `https://agents-company.escalonalabs.com/webhooks/github`

That keeps operator UI, control-plane API, and GitHub webhook delivery on one
DNS surface while preserving internal service separation.

## Validation

Repository-level hosted validation:

```bash
pnpm ops:validate:helm
pnpm ops:validate:aws-infra
```

Helm validation checks:

- lint with default, staging, and production values
- render with default, staging, and production values

Terraform validation checks:

- `terraform fmt -check`
- `terraform init -backend=false`
- `terraform validate`

## Reliability drills

Local operational drills shipped in-repo:

- `pnpm ops:backup:postgres`
- `pnpm ops:restore-drill:postgres`
- `pnpm ops:drill:compose-recovery`

Hosted runtime equivalents to run per environment:

- RDS snapshot restore rehearsal
- webhook replay drill against a staging GitHub App installation
- secrets rotation rehearsal for runtime secrets and internal API token
- Helm rollback drill to previous known-good release

The local drills are the reproducible baseline; hosted drills still require the
actual AWS account, EKS cluster, and GitHub App installation.

## Limits of repo-only validation

This repository now validates the infrastructure contract and deployment assets,
but it cannot prove hosted production is live without:

- AWS credentials
- an actual EKS cluster
- External Secrets Operator installed
- a real GitHub App installation
- pushed images in the target ECR repositories

So `M15` can be repo-ready and operationally rehearsable here, but final hosted
go-live still depends on those environment-specific steps.
