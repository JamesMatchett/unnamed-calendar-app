environment = "dev"

# From `terraform output` in src/terraform/bootstrap for this account.
account_id       = "REPLACE_WITH_ACCOUNT_ID"
state_bucket_arn = "arn:aws:s3:::uca-tfstate-dev-REPLACE_WITH_ACCOUNT_ID"

# Dev is the one environment where recreating the table is reasonable.
# Note this only relaxes DynamoDB's own protection; the prevent_destroy
# lifecycle rule in modules/data/main.tf still applies. See that comment.
deletion_protection = false
