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
