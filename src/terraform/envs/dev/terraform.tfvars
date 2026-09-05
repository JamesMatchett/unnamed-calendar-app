environment = "dev"

# From `terraform output` in src/terraform/bootstrap for this account.
# The state bucket's ARN is derived from this in main.tf, not copied here.
account_id = "392852903961"

# Dev is the one environment where recreating the table is reasonable.
# Note this only relaxes DynamoDB's own protection; the prevent_destroy
# lifecycle rule in modules/data/main.tf still applies. See that comment.
deletion_protection = false

# The only source of a valid JWT until Apple and Google federation exists, so
# that the authoriser on /v1/me can be shown to accept a token rather than only
# to reject the absence of one. Dev only; delete it once federation is wired up.
# See modules/auth/variables.tf.
test_client_enabled = true
