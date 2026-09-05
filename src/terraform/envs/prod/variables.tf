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

variable "deletion_protection" {
  description = "DynamoDB deletion protection. See modules/data/variables.tf."
  type        = bool
  default     = true
}
