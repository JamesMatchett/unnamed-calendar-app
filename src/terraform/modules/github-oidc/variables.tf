variable "project" {
  description = "Short project prefix used in resource names."
  type        = string
}

variable "environment" {
  description = "Environment name (dev | staging | prod)."
  type        = string
}

variable "github_repository" {
  description = "GitHub repository in owner/name form, e.g. JamesMatchett/unnamed-calendar-app."
  type        = string
}

variable "github_owner_id" {
  description = <<-EOT
    Numeric id of the GitHub account that owns the repository, as it appears in
    the OIDC subject claim. Read it from the repository_owner_id claim on a
    token, or from GitHub's subject-claim preview; it is not the account name
    and it never changes when the account is renamed.
  EOT
  type        = string
}

variable "github_repository_id" {
  description = <<-EOT
    Numeric id of the GitHub repository, as it appears in the OIDC subject
    claim. Deleting and recreating the repository under the same name produces
    a different id, which is the whole reason this is pinned rather than the
    name.
  EOT
  type        = string
}

variable "state_bucket_arn" {
  description = "ARN of this environment's Terraform state bucket."
  type        = string
}

variable "create_oidc_provider" {
  description = <<-EOT
    Whether to create the GitHub OIDC provider in this account. One provider per
    AWS account; set false if something else in the account already created it.
  EOT
  type        = bool
  default     = true
}
