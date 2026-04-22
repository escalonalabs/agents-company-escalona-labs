# Hosted AWS Infrastructure

This directory contains the versioned hosted deployment scaffold for
`Agents Company by Escalona Labs` on AWS.

## What it provisions

- EKS cluster and managed node group
- Core EKS add-ons (`coredns`, `kube-proxy`, `vpc-cni`)
- CloudWatch log group for cluster control-plane logs
- S3 bucket for execution artifacts with encryption, versioning, and lifecycle
- RDS Postgres instance
- Secrets Manager secret holding the runtime environment payload
- IRSA role for runtime workloads
- ECR repositories for `control-plane`, `github-app`, and `control-web`
- Optional SES sender identity

## Required prerequisites

- Existing VPC and subnets
- AWS credentials with permission to create the resources above
- External Secrets Operator installed in the target EKS cluster
- A `ClusterSecretStore` or `SecretStore` that can read the runtime secret from
  AWS Secrets Manager
- Helm release values aligned with:
  - `runtimeSecret.existingSecretName`
  - `runtimeSecret.externalSecret.remoteSecretKey`
  - `controlPlane.serviceAccount.name`
  - `githubApp.serviceAccount.name`

The staged and production Helm values in
[`charts/agents-company`](../../charts/agents-company) assume:

- runtime secret names:
  - `agents-company-staging-runtime`
  - `agents-company-production-runtime`
- trusted service accounts:
  - `agents-company-control-plane`
  - `agents-company-github-app`

If you change those names in Helm, update `service_account_names` in Terraform
to match before applying.

## Examples

- [`staging.tfvars.example`](./staging.tfvars.example)
- [`production.tfvars.example`](./production.tfvars.example)

## Validation

Run validation without installing Terraform locally:

```bash
pnpm ops:validate:aws-infra
```

That command uses a Dockerized Terraform toolchain to run:

- `terraform fmt -check`
- `terraform init -backend=false`
- `terraform validate`

## Typical apply flow

```bash
cp infra/aws/staging.tfvars.example /tmp/agents-company-staging.tfvars
# fill in real VPC ids, subnet ids, secrets, and GitHub App values

terraform -chdir=infra/aws init
terraform -chdir=infra/aws plan -var-file=/tmp/agents-company-staging.tfvars
terraform -chdir=infra/aws apply -var-file=/tmp/agents-company-staging.tfvars
```

## Important outputs

- `cluster_name`
- `cluster_endpoint`
- `artifact_bucket_name`
- `postgres_endpoint`
- `runtime_secret_arn`
- `runtime_irsa_role_arn`
- `helm_runtime_secret_name`
- `helm_runtime_service_account_names`
- `helm_values_hint`

`helm_values_hint.runtime_secret_remote_key` is the Secrets Manager key that the
Helm `ExternalSecret` must extract into the Kubernetes runtime secret.
