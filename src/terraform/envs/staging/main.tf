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

module "auth" {
  source = "../../modules/auth"

  project             = var.project
  environment         = var.environment
  deletion_protection = var.deletion_protection
  test_client_enabled = var.test_client_enabled

  # The same bundle modules/api ships. The Pre Token Generation trigger is one
  # more handler in it, not a second artifact.
  bundle_dir = "${path.module}/../../../packages/api/dist"

  table_name        = module.data.table_name
  table_arn         = module.data.table_arn
  table_kms_key_arn = module.data.kms_key_arn
}

module "dns" {
  source = "../../modules/dns"

  zone_name   = var.zone_name
  environment = var.environment
}

module "api" {
  source = "../../modules/api"

  project     = var.project
  environment = var.environment

  # Built by `npm run build:api` before Terraform runs. Both workflows do this
  # before plan and apply; from a laptop, `npm run verify` is enough.
  bundle_dir = "${path.module}/../../../packages/api/dist"

  issuer    = "https://${module.auth.user_pool_endpoint}"
  audiences = module.auth.audiences

  table_name        = module.data.table_name
  table_arn         = module.data.table_arn
  table_kms_key_arn = module.data.kms_key_arn

  domain_name = var.api_domain
  zone_id     = module.dns.zone_id

  commit = var.commit
}
