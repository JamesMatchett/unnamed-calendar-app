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

module "data" {
  source = "../../modules/data"

  project             = var.project
  environment         = var.environment
  deletion_protection = var.deletion_protection
}

module "github_oidc" {
  source = "../../modules/github-oidc"

  project           = var.project
  environment       = var.environment
  github_repository = var.github_repository
  state_bucket_arn  = var.state_bucket_arn
}
