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
    Enables DynamoDB deletion protection. Keep true everywhere except a dev table you
    genuinely intend to recreate. Note this is separate from the `prevent_destroy`
    lifecycle rule in main.tf, which cannot be made conditional — see the comment there.
  EOT
  type        = bool
  default     = true
}

variable "kms_deletion_window_days" {
  description = "Waiting period before the table's CMK is deleted, if ever scheduled."
  type        = number
  default     = 30
}
