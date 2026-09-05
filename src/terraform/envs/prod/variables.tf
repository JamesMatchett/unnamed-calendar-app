variable "project" {
  description = "Short project prefix used in resource names."
  type        = string
  default     = "calder"
}

variable "environment" {
  description = "Environment name."
  type        = string
}

variable "region" {
  description = "AWS region."
  type        = string
  default     = "eu-west-2"
}

variable "account_id" {
  description = "The AWS account this environment must deploy into."
  type        = string
}

variable "github_repository" {
  description = "GitHub repository in owner/name form."
  type        = string
  default     = "JamesMatchett/unnamed-calendar-app"
}

variable "github_owner_id" {
  description = "Numeric id of the GitHub account owning the repository. Part of the OIDC subject claim; see modules/github-oidc."
  type        = string
  default     = "30292929"
}

variable "github_repository_id" {
  description = "Numeric id of the GitHub repository. Part of the OIDC subject claim; see modules/github-oidc."
  type        = string
  default     = "1354994048"
}

variable "deletion_protection" {
  description = "DynamoDB deletion protection. See modules/data/variables.tf."
  type        = bool
  default     = true
}

variable "zone_name" {
  description = "This environment's delegated DNS zone. See modules/dns."
  type        = string
  default     = "api.calandder.com"
}

variable "test_client_enabled" {
  description = "Admin-password app client, for minting a token before federation exists. See modules/auth."
  type        = bool
  default     = false
}

variable "commit" {
  description = <<-EOT
    The commit the Lambda bundle was built from, reported by /v1/health. Set by CI
    as TF_VAR_commit; left unknown when Terraform runs from a laptop, which is
    itself a useful thing to be able to see in a response.
  EOT
  type        = string
  default     = "unknown"
}

variable "api_domain" {
  # Not the apex. calandder.com serves the site, the invite pages and
  # .well-known/apple-app-site-association, and a universal link only works
  # from the host that serves that file, so the API lives beside it.
  description = "The hostname the API answers on. Must sit inside zone_name."
  type        = string
  default     = "api.calandder.com"
}

variable "auth_domain_prefix" {
  description = "Cognito hosted domain prefix. Unique per region; see modules/auth."
  type        = string
  default     = "calder-prod"
}

variable "callback_urls" {
  description = "Exact URLs Cognito may return to after sign-in. See modules/auth."
  type        = list(string)
  default     = ["calandder://auth"]
}

variable "apple_enabled" {
  description = <<-EOT
    Whether Sign in with Apple exists in this environment. Set in the committed
    tfvars, because whether a provider should exist is not a secret and must not
    be inferred from whether one is to hand. Its identifiers are read from SSM;
    see modules/auth/variables.tf and src/terraform/README.md.
  EOT
  type        = bool
  default     = false
}

variable "google_enabled" {
  description = "Whether Google exists in this environment. See apple_enabled."
  type        = bool
  default     = false
}

variable "apple_private_key" {
  description = "The .p8 contents, needed only when the provider is created. Pass via TF_VAR_apple_private_key; never commit."
  type        = string
  default     = ""
  sensitive   = true
}

variable "google_client_secret" {
  description = "Its secret, needed only at creation. Pass via TF_VAR_google_client_secret; never commit."
  type        = string
  default     = ""
  sensitive   = true
}
