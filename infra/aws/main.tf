data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}

locals {
  effective_name_prefix = trimspace(var.name_prefix) != "" ? trimspace(var.name_prefix) : "agents-company-${var.environment}"
  common_tags = merge(
    {
      Project     = "agents-company"
      Environment = var.environment
      ManagedBy   = "terraform"
    },
    var.tags,
  )
}

data "aws_iam_policy_document" "eks_cluster_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["eks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "eks_cluster" {
  name               = "${local.effective_name_prefix}-eks-cluster"
  assume_role_policy = data.aws_iam_policy_document.eks_cluster_assume_role.json
  tags               = local.common_tags
}

resource "aws_iam_role_policy_attachment" "eks_cluster_policy" {
  role       = aws_iam_role.eks_cluster.name
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/AmazonEKSClusterPolicy"
}

resource "aws_cloudwatch_log_group" "eks_cluster" {
  name              = "/aws/eks/${local.effective_name_prefix}/cluster"
  retention_in_days = 30
  tags              = local.common_tags
}

resource "aws_security_group" "eks_cluster" {
  name        = "${local.effective_name_prefix}-eks-cluster"
  description = "Cluster security group for Agents Company ${var.environment}"
  vpc_id      = var.vpc_id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.common_tags, {
    Name = "${local.effective_name_prefix}-eks-cluster"
  })
}

resource "aws_eks_cluster" "this" {
  name     = local.effective_name_prefix
  role_arn = aws_iam_role.eks_cluster.arn
  version  = var.eks_version

  enabled_cluster_log_types = [
    "api",
    "audit",
    "authenticator",
    "controllerManager",
    "scheduler",
  ]

  vpc_config {
    subnet_ids              = distinct(concat(var.private_subnet_ids, var.public_subnet_ids))
    endpoint_private_access = true
    endpoint_public_access  = true
    public_access_cidrs     = var.eks_public_access_cidrs
    security_group_ids      = [aws_security_group.eks_cluster.id]
  }

  depends_on = [
    aws_cloudwatch_log_group.eks_cluster,
    aws_iam_role_policy_attachment.eks_cluster_policy,
  ]

  tags = local.common_tags
}

data "aws_iam_policy_document" "eks_node_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "eks_node" {
  name               = "${local.effective_name_prefix}-eks-node"
  assume_role_policy = data.aws_iam_policy_document.eks_node_assume_role.json
  tags               = local.common_tags
}

resource "aws_iam_role_policy_attachment" "eks_node_worker" {
  role       = aws_iam_role.eks_node.name
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/AmazonEKSWorkerNodePolicy"
}

resource "aws_iam_role_policy_attachment" "eks_node_cni" {
  role       = aws_iam_role.eks_node.name
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/AmazonEKS_CNI_Policy"
}

resource "aws_iam_role_policy_attachment" "eks_node_ecr" {
  role       = aws_iam_role.eks_node.name
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly"
}

resource "aws_eks_node_group" "default" {
  cluster_name    = aws_eks_cluster.this.name
  node_group_name = "${local.effective_name_prefix}-default"
  node_role_arn   = aws_iam_role.eks_node.arn
  subnet_ids      = var.private_subnet_ids
  instance_types  = var.node_instance_types

  scaling_config {
    desired_size = var.node_desired_size
    min_size     = var.node_min_size
    max_size     = var.node_max_size
  }

  update_config {
    max_unavailable = 1
  }

  depends_on = [
    aws_iam_role_policy_attachment.eks_node_worker,
    aws_iam_role_policy_attachment.eks_node_cni,
    aws_iam_role_policy_attachment.eks_node_ecr,
  ]

  tags = local.common_tags
}

resource "aws_eks_addon" "coredns" {
  cluster_name = aws_eks_cluster.this.name
  addon_name   = "coredns"

  depends_on = [aws_eks_node_group.default]

  tags = local.common_tags
}

resource "aws_eks_addon" "kube_proxy" {
  cluster_name = aws_eks_cluster.this.name
  addon_name   = "kube-proxy"

  depends_on = [aws_eks_node_group.default]

  tags = local.common_tags
}

resource "aws_eks_addon" "vpc_cni" {
  cluster_name = aws_eks_cluster.this.name
  addon_name   = "vpc-cni"

  depends_on = [aws_eks_node_group.default]

  tags = local.common_tags
}

data "tls_certificate" "eks_oidc" {
  url = aws_eks_cluster.this.identity[0].oidc[0].issuer
}

resource "aws_iam_openid_connect_provider" "eks" {
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = [data.tls_certificate.eks_oidc.certificates[0].sha1_fingerprint]
  url             = aws_eks_cluster.this.identity[0].oidc[0].issuer
  tags            = local.common_tags
}

data "aws_iam_policy_document" "runtime_irsa_assume_role" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.eks.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "${replace(aws_eks_cluster.this.identity[0].oidc[0].issuer, "https://", "")}:sub"
      values = [
        for service_account_name in var.service_account_names :
        "system:serviceaccount:${var.kubernetes_namespace}:${service_account_name}"
      ]
    }

    condition {
      test     = "StringEquals"
      variable = "${replace(aws_eks_cluster.this.identity[0].oidc[0].issuer, "https://", "")}:aud"
      values   = ["sts.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "runtime_irsa" {
  name               = "${local.effective_name_prefix}-runtime"
  assume_role_policy = data.aws_iam_policy_document.runtime_irsa_assume_role.json
  tags               = local.common_tags
}

resource "aws_s3_bucket" "artifacts" {
  bucket        = trimspace(var.artifact_bucket_name) != "" ? trimspace(var.artifact_bucket_name) : "${local.effective_name_prefix}-${data.aws_caller_identity.current.account_id}-artifacts"
  force_destroy = var.environment != "production"
  tags          = local.common_tags
}

resource "aws_s3_bucket_versioning" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "artifacts" {
  bucket                  = aws_s3_bucket.artifacts.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id

  rule {
    id     = "artifact-retention"
    status = "Enabled"

    filter {}

    noncurrent_version_expiration {
      noncurrent_days = var.environment == "production" ? 30 : 14
    }
  }
}

resource "aws_security_group" "rds" {
  name        = "${local.effective_name_prefix}-rds"
  description = "Database access for Agents Company ${var.environment}"
  vpc_id      = var.vpc_id

  ingress {
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = [var.vpc_cidr_block]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.common_tags, {
    Name = "${local.effective_name_prefix}-rds"
  })
}

resource "aws_db_subnet_group" "postgres" {
  name       = "${local.effective_name_prefix}-postgres"
  subnet_ids = var.private_subnet_ids
  tags       = local.common_tags
}

resource "aws_db_instance" "postgres" {
  identifier                     = "${local.effective_name_prefix}-postgres"
  db_name                        = var.db_name
  username                       = var.db_username
  password                       = var.db_password
  instance_class                 = var.db_instance_class
  allocated_storage              = var.db_allocated_storage
  storage_encrypted              = true
  engine                         = "postgres"
  engine_version                 = var.db_engine_version
  auto_minor_version_upgrade     = true
  backup_retention_period        = var.db_backup_retention_days
  delete_automated_backups       = false
  db_subnet_group_name           = aws_db_subnet_group.postgres.name
  vpc_security_group_ids         = [aws_security_group.rds.id]
  multi_az                       = var.db_multi_az
  apply_immediately              = false
  copy_tags_to_snapshot          = true
  deletion_protection            = var.environment == "production"
  skip_final_snapshot            = var.db_skip_final_snapshot
  performance_insights_enabled   = var.environment == "production"
  publicly_accessible            = false
  iam_database_authentication_enabled = false

  tags = local.common_tags
}

resource "aws_secretsmanager_secret" "runtime" {
  name                    = "${local.effective_name_prefix}/runtime"
  recovery_window_in_days = 7
  tags                    = local.common_tags
}

resource "aws_secretsmanager_secret_version" "runtime" {
  secret_id = aws_secretsmanager_secret.runtime.id

  secret_string = jsonencode({
    AGENTS_COMPANY_NODE_ENV             = "production"
    AGENTS_COMPANY_APP_URL              = "https://${var.environment == "production" ? "agents-company.escalonalabs.com" : "staging.agents-company.escalonalabs.com"}"
    AGENTS_COMPANY_DATABASE_URL         = "postgresql://${var.db_username}:${var.db_password}@${aws_db_instance.postgres.address}:5432/${var.db_name}"
    AGENTS_COMPANY_STORAGE_ENDPOINT     = "https://s3.${var.aws_region}.amazonaws.com"
    AGENTS_COMPANY_STORAGE_REGION       = var.aws_region
    AGENTS_COMPANY_STORAGE_BUCKET       = aws_s3_bucket.artifacts.bucket
    AGENTS_COMPANY_STORAGE_ACCESS_KEY   = "use-irsa"
    AGENTS_COMPANY_STORAGE_SECRET_KEY   = "use-irsa"
    AGENTS_COMPANY_STORAGE_FORCE_PATH_STYLE = "false"
    AGENTS_COMPANY_MAIL_SMTP_URL        = var.mail_smtp_url
    AGENTS_COMPANY_MAIL_FROM            = var.mail_from
    AGENTS_COMPANY_MAIL_UI_URL          = ""
    AGENTS_COMPANY_SESSION_SECRET       = var.session_secret
    AGENTS_COMPANY_SESSION_TTL_HOURS    = "168"
    AGENTS_COMPANY_INVITATION_TTL_HOURS = "168"
    AGENTS_COMPANY_INTERNAL_API_TOKEN   = var.internal_api_token
    AGENTS_COMPANY_GITHUB_APP_ID        = var.github_app_id
    AGENTS_COMPANY_GITHUB_WEBHOOK_SECRET = var.github_webhook_secret
    AGENTS_COMPANY_GITHUB_PRIVATE_KEY   = var.github_private_key
    AGENTS_COMPANY_GITHUB_API_BASE_URL  = var.github_api_base_url
  })
}

data "aws_iam_policy_document" "runtime_access" {
  statement {
    sid = "ArtifactsBucketAccess"
    actions = [
      "s3:AbortMultipartUpload",
      "s3:DeleteObject",
      "s3:GetObject",
      "s3:ListBucket",
      "s3:PutObject",
    ]
    resources = [
      aws_s3_bucket.artifacts.arn,
      "${aws_s3_bucket.artifacts.arn}/*",
    ]
  }

  statement {
    sid = "ReadRuntimeSecret"
    actions = [
      "secretsmanager:DescribeSecret",
      "secretsmanager:GetSecretValue",
    ]
    resources = [aws_secretsmanager_secret.runtime.arn]
  }
}

resource "aws_iam_policy" "runtime_access" {
  name   = "${local.effective_name_prefix}-runtime-access"
  policy = data.aws_iam_policy_document.runtime_access.json
  tags   = local.common_tags
}

resource "aws_iam_role_policy_attachment" "runtime_access" {
  role       = aws_iam_role.runtime_irsa.name
  policy_arn = aws_iam_policy.runtime_access.arn
}

resource "aws_ses_email_identity" "sender" {
  count = trimspace(var.ses_sender_email) != "" ? 1 : 0

  email = trimspace(var.ses_sender_email)
}

resource "aws_ecr_repository" "control_plane" {
  name                 = "${local.effective_name_prefix}/control-plane"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = local.common_tags
}

resource "aws_ecr_repository" "github_app" {
  name                 = "${local.effective_name_prefix}/github-app"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = local.common_tags
}

resource "aws_ecr_repository" "control_web" {
  name                 = "${local.effective_name_prefix}/control-web"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = local.common_tags
}
