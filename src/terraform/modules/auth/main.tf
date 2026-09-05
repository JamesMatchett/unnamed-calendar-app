# ---------------------------------------------------------------------------
# One Cognito user pool per environment. No identity pool.
#
# See Architecture.md §3.2. The short version of the decisions encoded here:
#
#   - Identity pools exist to vend AWS credentials to clients. Nothing here
#     needs them: clients talk to API Gateway with a JWT, and S3 uploads will
#     use presigned URLs minted by Lambda.
#   - The pool holds identity and nothing else. No custom attributes: they are
#     capped, cannot be removed once created, and changing them can force pool
#     replacement. The profile lives in DynamoDB, which is what makes the
#     swap-the-IdP escape hatch real rather than theoretical.
#   - The user id is a ULID minted at first sign-in, NOT Cognito's `sub`
#     (§3.2). Nothing in this module writes a user id; the mapping item and the
#     Pre Token Generation trigger that injects it belong to the next slice.
#
# NOT here yet, deliberately: the Apple and Google identity providers, the three
# Lambda triggers, and the custom domain. Each needs something that does not
# exist — client credentials from Apple and Google, a table to write to, and an
# ACM certificate against a delegated zone.
# ---------------------------------------------------------------------------

locals {
  name = "${var.project}-${var.environment}"
}

resource "aws_cognito_user_pool" "main" {
  name = local.name

  # Losing this pool orphans every membership row in the table. One per
  # environment, never shared between dev and prod.
  deletion_protection = var.deletion_protection ? "ACTIVE" : "INACTIVE"

  # Email is an alias, never a key. People change addresses and Apple's Hide My
  # Email issues a per-app relay, so an address identifies a login attempt and
  # never a person (§3.2, §7.2).
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]

  # No passwords in v1 (§8.6), so no reset flow and no password support burden.
  # This policy governs the admin-created user the test client exists for, and
  # is written to be strict rather than nominal because that user is real.
  password_policy {
    minimum_length                   = 16
    require_lowercase                = true
    require_uppercase                = true
    require_numbers                  = true
    require_symbols                  = true
    temporary_password_validity_days = 1
  }

  # No schema block. `name` and `email` are standard attributes and already
  # exist; declaring one here would add nothing and a schema change can force
  # the pool to be replaced. Custom attributes are avoided entirely (§3.2):
  # they are capped, cannot be removed once created, and the profile lives in
  # DynamoDB precisely so that the pool stays thin enough to swap out.
  #
  # Capturing the display name that Apple returns on the first authorisation
  # and never again is a job for the Post Confirmation trigger, not for a
  # declaration here.

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  lifecycle {
    # The pool is the one resource here whose loss cannot be repaired by
    # reapplying: the table survives, but every item keyed on a departed `sub`
    # is stranded. Same reasoning as the table's rule in modules/data.
    prevent_destroy = true

    # Cognito returns every standard attribute in the pool's schema, and the
    # provider compares that against a config which declares none, so without
    # this a plan can show a schema diff for ever and, worse, propose replacing
    # the pool to resolve it. Adding an attribute deliberately means removing
    # this line in the same commit, which is the intended amount of friction.
    ignore_changes = [schema]
  }
}

# --- the app's client -------------------------------------------------------

resource "aws_cognito_user_pool_client" "app" {
  name         = "${local.name}-app"
  user_pool_id = aws_cognito_user_pool.main.id

  # Public client with PKCE. A mobile app cannot keep a secret, and shipping one
  # is worse than not having it because it invites treating it as a control.
  generate_secret = false

  # Only SRP and refresh. USER_PASSWORD_AUTH is absent rather than false: there
  # are no passwords to send, and leaving the flow enabled means an attacker can
  # attempt credential stuffing against a pool that should refuse the question.
  explicit_auth_flows = [
    "ALLOW_USER_SRP_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH",
  ]

  # Hours for access and ID, per §3.2. Days for refresh, because the offline
  # path in §5.6 should not be reached by a token quietly expiring.
  access_token_validity  = 1
  id_token_validity      = 1
  refresh_token_validity = var.refresh_token_days

  token_validity_units {
    access_token  = "hours"
    id_token      = "hours"
    refresh_token = "days"
  }

  # Sign-out should end the session everywhere, not just locally.
  enable_token_revocation = true

  # Cognito's default is to answer "no such user" distinctly from "wrong
  # password", which enumerates accounts. This makes both answers identical.
  prevent_user_existence_errors = "ENABLED"

  # Read and write the profile attributes the app actually uses. Left implicit,
  # Cognito grants the client everything, including attributes added later by
  # somebody who was not thinking about this client.
  read_attributes  = ["email", "email_verified", "name"]
  write_attributes = ["email", "name"]
}

# --- a way to get a token before Apple and Google exist ----------------------

# There is no other source of a valid JWT yet. Without one, the authoriser on
# /v1/me can be shown to reject an anonymous call and nothing more, and "rejects
# everything" is also what a completely broken authoriser looks like.
#
# So: a second client, off by default, that permits ADMIN_USER_PASSWORD_AUTH.
# The admin flow is server-side only — it cannot be driven from a browser or a
# phone, and it needs IAM permission on top of the password — so enabling it
# does not put a password path in front of real users. The app's client above is
# untouched either way.
#
# This is scaffolding. It comes out when federation goes in.
resource "aws_cognito_user_pool_client" "test" {
  count = var.test_client_enabled ? 1 : 0

  name         = "${local.name}-test"
  user_pool_id = aws_cognito_user_pool.main.id

  generate_secret = false

  explicit_auth_flows = [
    "ALLOW_ADMIN_USER_PASSWORD_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH",
  ]

  access_token_validity  = 1
  id_token_validity      = 1
  refresh_token_validity = 1

  token_validity_units {
    access_token  = "hours"
    id_token      = "hours"
    refresh_token = "days"
  }

  enable_token_revocation       = true
  prevent_user_existence_errors = "ENABLED"
}
