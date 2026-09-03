# The S3 backend cannot take variables, so bucket and key are literal per
# environment. Populate the bucket name from the bootstrap output for this
# account (see src/terraform/README.md).
terraform {
  backend "s3" {
    bucket = "calder-tfstate-dev-REPLACE_WITH_ACCOUNT_ID"
    key    = "envs/dev/terraform.tfstate"
    region = "eu-west-2"

    # Native S3 locking. No DynamoDB lock table (Architecture.md §3.6).
    use_lockfile = true
    encrypt      = true
  }
}
