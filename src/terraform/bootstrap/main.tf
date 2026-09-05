# ---------------------------------------------------------------------------
# Run ONCE per AWS account, by a human with admin credentials, using LOCAL state.
# It creates the S3 bucket that every subsequent Terraform run stores its state
# in — the chicken-and-egg step that cannot itself live in remote state.
#
#   cd src/terraform/bootstrap
#   terraform init
#   terraform apply -var environment=dev
#
# There is no DynamoDB lock table. Terraform's S3 backend locks natively via
# use_lockfile (Architecture.md §3.6).
# ---------------------------------------------------------------------------

terraform {
  required_version = ">= 1.16.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project     = var.project
      Environment = var.environment
      ManagedBy   = "terraform"
      Component   = "bootstrap"
    }
  }
}

data "aws_caller_identity" "current" {}

locals {
  # Bucket names are globally unique, so the account id disambiguates.
  bucket_name = "${var.project}-tfstate-${var.environment}-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket" "state" {
  bucket = local.bucket_name

  lifecycle {
    prevent_destroy = true
  }
}

# Versioning is not optional. It is the only route back from a corrupted or
# truncated state file, and state corruption is the failure mode that turns a
# bad afternoon into a rebuild.
resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  bucket = aws_s3_bucket.state.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "state" {
  bucket = aws_s3_bucket.state.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# State files contain resource metadata and occasionally secrets. Refuse
# anything that is not TLS.
data "aws_iam_policy_document" "state_tls_only" {
  statement {
    effect  = "Deny"
    actions = ["s3:*"]

    resources = [
      aws_s3_bucket.state.arn,
      "${aws_s3_bucket.state.arn}/*",
    ]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "state" {
  bucket = aws_s3_bucket.state.id
  policy = data.aws_iam_policy_document.state_tls_only.json
}

# Old state versions accumulate forever otherwise. Ninety days is well past any
# realistic recovery window.
resource "aws_s3_bucket_lifecycle_configuration" "state" {
  bucket = aws_s3_bucket.state.id

  rule {
    id     = "expire-noncurrent-state"
    status = "Enabled"

    filter {}

    noncurrent_version_expiration {
      noncurrent_days = 90
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}
