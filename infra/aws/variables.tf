variable "aws_region" {
  description = "AWS region for the hosted deployment."
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Hosted environment name."
  type        = string

  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "environment must be either staging or production."
  }
}

variable "name_prefix" {
  description = "Optional explicit name prefix. Defaults to agents-company-<environment>."
  type        = string
  default     = ""
}

variable "kubernetes_namespace" {
  description = "Kubernetes namespace for the Helm release."
  type        = string
  default     = "agents-company"
}

variable "vpc_id" {
  description = "Existing VPC id used by the hosted cluster."
  type        = string
}

variable "vpc_cidr_block" {
  description = "CIDR block for the existing VPC."
  type        = string
}

variable "private_subnet_ids" {
  description = "Private subnet ids for EKS worker nodes and RDS."
  type        = list(string)
}

variable "public_subnet_ids" {
  description = "Public subnet ids for EKS control plane access or load balancers."
  type        = list(string)
  default     = []
}

variable "eks_version" {
  description = "Kubernetes version for the hosted EKS cluster."
  type        = string
  default     = "1.31"
}

variable "eks_public_access_cidrs" {
  description = "Allowed public CIDRs for the EKS API endpoint."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "node_instance_types" {
  description = "EC2 instance types for the managed node group."
  type        = list(string)
  default     = ["t3.large"]
}

variable "node_desired_size" {
  description = "Desired worker node count."
  type        = number
  default     = 2
}

variable "node_min_size" {
  description = "Minimum worker node count."
  type        = number
  default     = 2
}

variable "node_max_size" {
  description = "Maximum worker node count."
  type        = number
  default     = 6
}

variable "db_name" {
  description = "Primary Postgres database name."
  type        = string
  default     = "agents_company"
}

variable "db_username" {
  description = "Primary Postgres username."
  type        = string
  default     = "agents_company"
}

variable "db_password" {
  description = "Primary Postgres password."
  type        = string
  sensitive   = true
}

variable "db_instance_class" {
  description = "RDS instance class."
  type        = string
  default     = "db.t4g.medium"
}

variable "db_allocated_storage" {
  description = "Allocated storage in GB for Postgres."
  type        = number
  default     = 100
}

variable "db_engine_version" {
  description = "Postgres engine version."
  type        = string
  default     = "16.4"
}

variable "db_backup_retention_days" {
  description = "Retention in days for automated RDS backups."
  type        = number
  default     = 7
}

variable "db_multi_az" {
  description = "Whether to enable Multi-AZ for RDS."
  type        = bool
  default     = true
}

variable "db_skip_final_snapshot" {
  description = "Whether destroy should skip the final RDS snapshot."
  type        = bool
  default     = false
}

variable "artifact_bucket_name" {
  description = "Optional explicit artifact bucket name."
  type        = string
  default     = ""
}

variable "mail_smtp_url" {
  description = "SMTP URL used by the control-plane mail adapter, typically SES SMTP."
  type        = string
}

variable "mail_from" {
  description = "Visible mail sender used by the platform."
  type        = string
  default     = "Agents Company <no-reply@agents-company.escalonalabs.com>"
}

variable "ses_sender_email" {
  description = "Optional sender email to verify in SES."
  type        = string
  default     = ""
}

variable "session_secret" {
  description = "Session secret stored in Secrets Manager."
  type        = string
  sensitive   = true
}

variable "internal_api_token" {
  description = "Shared internal token stored in Secrets Manager."
  type        = string
  sensitive   = true
}

variable "github_app_id" {
  description = "GitHub App id for the hosted environment."
  type        = string
  sensitive   = true
}

variable "github_webhook_secret" {
  description = "GitHub webhook secret for hosted ingestion."
  type        = string
  sensitive   = true
}

variable "github_private_key" {
  description = "GitHub App private key PEM."
  type        = string
  sensitive   = true
}

variable "github_api_base_url" {
  description = "GitHub API base URL."
  type        = string
  default     = "https://api.github.com"
}

variable "service_account_names" {
  description = "Kubernetes service account names trusted to assume the runtime IRSA role."
  type        = list(string)
  default = [
    "agents-company-control-plane",
    "agents-company-github-app",
  ]

  validation {
    condition     = length(var.service_account_names) > 0
    error_message = "service_account_names must include at least one Kubernetes service account."
  }
}

variable "tags" {
  description = "Additional resource tags."
  type        = map(string)
  default     = {}
}
