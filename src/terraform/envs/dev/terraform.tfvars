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

# Apple is configured in dev. This says the provider should EXIST; its Services
# ID, Team ID and Key ID are read from /calder/dev/public/auth/apple/* in SSM,
# and the .p8 is passed at apply time only when the provider is being created.
#
# It is a committed setting on purpose. When this was inferred from whether the
# credentials were in the environment, CI's apply — which passes TF_VAR_commit
# and nothing else — destroyed the provider on merge and the app was served an
# empty list of sign-in buttons.
apple_enabled  = true
google_enabled = false
