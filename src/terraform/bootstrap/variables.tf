variable "project" {
  description = "Short project prefix used in resource names."
  type        = string
  default     = "uca"
}

variable "environment" {
  description = "Environment this account hosts (dev | staging | prod)."
  type        = string
}

variable "region" {
  description = "AWS region. London, per Architecture.md §13."
  type        = string
  default     = "eu-west-2"
}
