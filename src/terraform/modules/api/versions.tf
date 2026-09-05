terraform {
  required_version = ">= 1.16.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }

    # Zips the bundle @calder/api builds. See the comment in main.tf about why
    # Terraform owns the artifact at this stage.
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.7"
    }
  }
}
