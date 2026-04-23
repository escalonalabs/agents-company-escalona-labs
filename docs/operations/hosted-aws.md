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

## GitHub Actions deployment path

The repository now ships a manual hosted deployment workflow:

- [`.github/workflows/hosted-deploy.yml`](../../.github/workflows/hosted-deploy.yml)

Use one GitHub environment per hosted target:

- `staging`
- `production`

Configure these values on each environment before dispatching the workflow:

| Name | Type | Purpose |
| --- | --- | --- |
| `AWS_ROLE_TO_ASSUME` | secret | IAM role assumed through GitHub OIDC for Terraform, ECR, EKS, and Secrets Manager access |
| `TF_VARS` | secret | Full multiline contents of the target `tfvars` file |
| `TF_BACKEND_BUCKET` | secret | S3 bucket used for Terraform remote state |
| `TF_BACKEND_KEY` | secret | Object key for the environment Terraform state |
| `TF_BACKEND_DYNAMODB_TABLE` | secret, optional | DynamoDB table for Terraform state locking |
| `AWS_REGION` | variable | AWS region for the environment |
| `KUBERNETES_NAMESPACE` | variable, optional | Helm target namespace, defaults to `agents-company-<environment>` |

The workflow performs this sequence:

1. Validate the repository and hosted assets.
2. Assume the environment IAM role through OIDC.
3. Initialize Terraform with the remote backend and apply the target `tfvars`.
4. Read Terraform outputs for the ECR repositories, cluster, and runtime secret.
5. Build and push the three immutable release images to ECR.
6. Update the EKS kubeconfig, verify `ExternalSecret` prerequisites, and run
   `helm upgrade --install`.
7. Wait for the three runtime deployments to become ready and verify the public
   health endpoint.

Dispatch example:

```text
workflow: hosted-deploy
environment: production
version: v0.1.0
ref: release/v0.1.0
```

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

- environment-level GitHub secrets and variables for the deploy workflow
- an AWS account reachable through the configured OIDC role
- a real EKS cluster
- External Secrets Operator installed
- a real GitHub App installation
- successful image pushes into the target ECR repositories

So `M15` can be repo-ready and operationally rehearsable here, but final hosted
go-live still depends on those environment-specific steps.
