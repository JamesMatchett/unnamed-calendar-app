variable "project" {
  description = "Short project prefix used in resource names."
  type        = string
}

variable "environment" {
  description = "Environment name (dev | staging | prod)."
  type        = string

  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "environment must be one of: dev, staging, prod."
  }
}

variable "bundle_dir" {
  description = <<-EOT
    Directory holding the built Lambda bundle, zipped as the deployment package.
    Its only contents should be index.mjs, produced by `npm run build:api`.

    A path rather than a prebuilt zip because the zip has to be built by whatever
    is running Terraform, and both workflows build it before plan and apply.
  EOT
  type        = string
}

variable "issuer" {
  description = "The user pool's issuer URL, which the JWT authoriser validates tokens against."
  type        = string
}

variable "audiences" {
  description = "Client ids a token may be issued to. A token with any other `aud` is rejected."
  type        = list(string)
}

variable "table_name" {
  description = "The DynamoDB table, passed to handlers as an environment variable."
  type        = string
}

variable "table_arn" {
  description = "The table, for the execution role's read and write grants."
  type        = string
}

variable "table_kms_key_arn" {
  description = <<-EOT
    The table's CMK. A customer-managed key means DynamoDB permission alone is not
    enough: without kms:Decrypt on this key every read fails with an error naming
    KMS rather than DynamoDB, which is a confusing hour the first time.
  EOT
  type        = string
}

variable "commit" {
  description = <<-EOT
    The commit the bundle was built from, reported by /v1/health. Unknown when
    Terraform runs from a laptop, which is itself worth being able to see in a
    response.
  EOT
  type        = string
  default     = "unknown"
}

variable "log_retention_days" {
  description = "CloudWatch log retention. Logs kept for ever are a bill, not a policy."
  type        = number
  default     = 14
}
