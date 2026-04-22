output "cluster_name" {
  description = "EKS cluster name."
  value       = aws_eks_cluster.this.name
}

output "cluster_endpoint" {
  description = "EKS cluster endpoint."
  value       = aws_eks_cluster.this.endpoint
}

output "artifact_bucket_name" {
  description = "S3 bucket used for execution artifacts."
  value       = aws_s3_bucket.artifacts.bucket
}

output "postgres_endpoint" {
  description = "Postgres endpoint for the hosted environment."
  value       = aws_db_instance.postgres.address
}

output "runtime_secret_arn" {
  description = "Secrets Manager ARN that stores runtime configuration."
  value       = aws_secretsmanager_secret.runtime.arn
}

output "runtime_irsa_role_arn" {
  description = "IRSA role ARN that Helm service accounts should assume."
  value       = aws_iam_role.runtime_irsa.arn
}

output "ecr_repositories" {
  description = "ECR repositories that store the production images."
  value = {
    control_plane = aws_ecr_repository.control_plane.repository_url
    github_app    = aws_ecr_repository.github_app.repository_url
    control_web   = aws_ecr_repository.control_web.repository_url
  }
}

output "helm_runtime_secret_name" {
  description = "Existing Kubernetes secret name referenced by the Helm staging/production values."
  value       = "agents-company-${var.environment}-runtime"
}

output "helm_runtime_service_account_names" {
  description = "Kubernetes service account names that must stay aligned with the IRSA trust policy."
  value       = var.service_account_names
}

output "helm_values_hint" {
  description = "Key values to wire into the staging or production Helm values files."
  value = {
    app_url                   = "https://${var.environment == "production" ? "agents-company.escalonalabs.com" : "staging.agents-company.escalonalabs.com"}"
    runtime_secret_name       = "agents-company-${var.environment}-runtime"
    runtime_secret_remote_key = aws_secretsmanager_secret.runtime.name
    runtime_service_accounts  = var.service_account_names
    irsa_role_arn             = aws_iam_role.runtime_irsa.arn
    artifact_bucket_name      = aws_s3_bucket.artifacts.bucket
    database_endpoint         = aws_db_instance.postgres.address
  }
}
