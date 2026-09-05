provider "aws" {
  region = var.region

  # A wrong-account apply is the expensive mistake this prevents. Terraform
  # refuses to run if the credentials resolve to anything else.
  allowed_account_ids = [var.account_id]

  default_tags {
    tags = {
      Project     = var.project
      Environment = var.environment
      ManagedBy   = "terraform"
      Repository  = var.github_repository
    }
  }
}

locals {
  # Derived, never passed in. This was a variable holding a second spelling of
  # the bucket bootstrap creates, and the two had already drifted apart: the
  # tfvars still carried the pre-rename prefix, so CI's roles would have been
  # granted access to a bucket that does not exist. One expression, one name.
  state_bucket_arn = "arn:aws:s3:::${var.project}-tfstate-${var.environment}-${var.account_id}"
}

module "data" {
  source = "../../modules/data"

  project             = var.project
  environment         = var.environment
  deletion_protection = var.deletion_protection
}

module "github_oidc" {
  source = "../../modules/github-oidc"

  project              = var.project
  environment          = var.environment
  github_repository    = var.github_repository
  github_owner_id      = var.github_owner_id
  github_repository_id = var.github_repository_id
  state_bucket_arn     = local.state_bucket_arn
}
