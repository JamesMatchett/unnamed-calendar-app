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
  default     = "dev.calandder.com"
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
  description = "The hostname the API answers on. Must sit inside zone_name."
  type        = string
  default     = "api.dev.calandder.com"
}
