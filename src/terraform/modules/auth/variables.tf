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

variable "deletion_protection" {
  description = <<-EOT
    Deletion protection on the user pool. Losing a pool is unrecoverable: every
    `sub` disappears and every membership row in DynamoDB is orphaned with no way
    to reconnect a person to their calendars (§3.2). Keep true everywhere except a
    dev pool with no real users in it.
  EOT
  type        = bool
  default     = true
}

variable "refresh_token_days" {
  description = <<-EOT
    Refresh token lifetime. Cognito defaults to 30 days, which is too short for an
    offline-first app: someone on a long trip should not routinely drop into the
    read-only mode of §5.6 because their token expired while they were away from a
    network. Access and ID tokens stay at the default hour.
  EOT
  type        = number
  default     = 180
}

variable "test_client_enabled" {
  description = <<-EOT
    Creates a second app client that allows admin password authentication, so a
    real token can be minted with the AWS CLI.

    v1 has no passwords (§3.2, §8.6) and the app's own client never gets this. It
    exists because Apple and Google credentials do not, and without it the JWT
    authoriser can only be shown to REJECT an unauthenticated call. Proving that
    it ACCEPTS a valid one needs a token from somewhere, and this is the only
    somewhere until federation is configured.

    Defaults false. Turn it on in dev, never anywhere with a real user in it, and
    delete it once Apple and Google are wired up.
  EOT
  type        = bool
  default     = false
}

variable "bundle_dir" {
  description = <<-EOT
    The built Lambda bundle, the same artifact modules/api ships. One zip, two
    functions, different handlers: there is one build, one version, and no way
    for the routes and the pool trigger to drift apart.
  EOT
  type        = string
}

variable "table_name" {
  description = "The table holding the IDENTITY#{sub} mapping the trigger reads and writes."
  type        = string
}

variable "table_arn" {
  description = "The table, for the trigger role's grants."
  type        = string
}

variable "table_kms_key_arn" {
  description = "The table's CMK. Without kms permissions every read fails naming KMS, not DynamoDB."
  type        = string
}

variable "log_retention_days" {
  description = "CloudWatch log retention for the trigger."
  type        = number
  default     = 14
}
