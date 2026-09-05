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

  # `pre_token_generation`, not `pre_token_generation_config`: the plain
  # attribute is trigger version 1, which is what the Lite plan allows and what
  # writes to the ID token. See the trigger's own comment below.
  lambda_config {
    pre_token_generation = aws_lambda_function.trigger.arn
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

  # --- the redirect flow --------------------------------------------------
  #
  # Authorization code with PKCE, which is the only flow a public client should
  # use: the code is useless without the verifier the app kept, so intercepting
  # the redirect gains an attacker nothing.
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]

  # `openid` is what makes Cognito issue an ID token at all, which is the token
  # this API validates and the one carrying the uid claim (decision 40).
  allowed_oauth_scopes = ["openid", "email", "profile"]

  callback_urls = var.callback_urls
  logout_urls   = var.callback_urls

  # COGNITO is absent on purpose: there are no passwords, so there is no
  # in-pool sign-in to offer. Until a provider is configured this list is empty
  # and the hosted flow has nothing to show, which is the honest state of it.
  supported_identity_providers = local.providers_configured

  depends_on = [
    aws_cognito_identity_provider.apple,
    aws_cognito_identity_provider.google,
  ]
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

# --- the Pre Token Generation trigger ----------------------------------------
#
# §3.2 decides that the user id is a ULID we mint and NOT Cognito's `sub`, so
# that rebuilding this pool or changing identity provider does not invalidate
# every key in the table. Something has to turn one into the other, and doing it
# here means it happens once per token rather than once per request.
#
# VERSION 1, deliberately. Version 2 can write claims into the ACCESS token and
# requires the Essentials feature plan; version 1 is available on Lite and can
# only write to the ID token. That is roughly $850/month at 100k MAU for one
# claim, so the API validates the ID token instead. §13 open question 1.
#
# The function lives in this module rather than in modules/api because it is
# part of what the pool does, not a route. It shares the API's bundle: same zip,
# different handler.

data "archive_file" "trigger" {
  type        = "zip"
  source_dir  = var.bundle_dir
  output_path = "${path.module}/.build/${var.environment}-trigger.zip"
}

data "aws_iam_policy_document" "trigger_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "trigger" {
  name               = "${local.name}-pretoken"
  description        = "Pre Token Generation trigger for the ${local.name} user pool"
  assume_role_policy = data.aws_iam_policy_document.trigger_assume.json
}

resource "aws_iam_role_policy_attachment" "trigger_basic" {
  role       = aws_iam_role.trigger.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

data "aws_iam_policy_document" "trigger_table" {
  # Read the mapping, and write it once. No Query, no Scan, no Delete: this
  # function resolves one item by primary key and creates two if they are
  # missing, and nothing it is allowed to do should exceed that.
  statement {
    effect = "Allow"
    actions = [
      "dynamodb:GetItem",
      "dynamodb:PutItem",
    ]
    resources = [var.table_arn]
  }

  statement {
    effect = "Allow"
    actions = [
      "kms:Decrypt",
      "kms:GenerateDataKey",
    ]
    resources = [var.table_kms_key_arn]
  }
}

resource "aws_iam_role_policy" "trigger_table" {
  name   = "identity-mapping"
  role   = aws_iam_role.trigger.id
  policy = data.aws_iam_policy_document.trigger_table.json
}

resource "aws_cloudwatch_log_group" "trigger" {
  name              = "/aws/lambda/${local.name}-pretoken"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "trigger" {
  function_name = "${local.name}-pretoken"
  role          = aws_iam_role.trigger.arn

  filename         = data.archive_file.trigger.output_path
  source_code_hash = data.archive_file.trigger.output_base64sha256

  handler       = "index.preTokenGeneration"
  runtime       = "nodejs22.x"
  architectures = ["arm64"]

  # This runs on the sign-in path, so its cold start is a person waiting. Small
  # and quick rather than cheap: it does one GetItem and usually nothing else.
  memory_size = 512
  timeout     = 5

  environment {
    variables = {
      CALDER_TABLE                        = var.table_name
      CALDER_ENVIRONMENT                  = var.environment
      AWS_NODEJS_CONNECTION_REUSE_ENABLED = "1"
    }
  }

  depends_on = [
    aws_cloudwatch_log_group.trigger,
    aws_iam_role_policy_attachment.trigger_basic,
  ]
}

resource "aws_lambda_permission" "trigger" {
  statement_id  = "AllowExecutionFromCognito"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.trigger.function_name
  principal     = "cognito-idp.amazonaws.com"
  source_arn    = aws_cognito_user_pool.main.arn
}

# --- the hosted domain, and the providers that redirect through it -----------

resource "aws_cognito_user_pool_domain" "main" {
  domain       = var.domain_prefix
  user_pool_id = aws_cognito_user_pool.main.id
}

locals {
  # Apple and Google both need this exact string in their own consoles, and
  # neither can be configured until it exists. That is why the domain is applied
  # before the providers rather than beside them.
  redirect_uri = "https://${aws_cognito_user_pool_domain.main.domain}.auth.${data.aws_region.current.region}.amazoncognito.com/oauth2/idpresponse"

  apple_ready  = var.apple_services_id != "" && var.apple_team_id != "" && var.apple_key_id != "" && var.apple_private_key != ""
  google_ready = var.google_client_id != "" && var.google_client_secret != ""

  providers_configured = compact([
    local.apple_ready ? "SignInWithApple" : "",
    local.google_ready ? "Google" : "",
  ])
}

data "aws_region" "current" {}

# The BUILT-IN Apple provider, not a generic OIDC one. They produce an identical
# sign-in and are billed a hundredfold differently: social providers get the
# 10,000-MAU free tier, generic OIDC gets fifty (§13, decision 42).
resource "aws_cognito_identity_provider" "apple" {
  count = local.apple_ready ? 1 : 0

  user_pool_id  = aws_cognito_user_pool.main.id
  provider_name = "SignInWithApple"
  provider_type = "SignInWithApple"

  provider_details = {
    client_id        = var.apple_services_id
    team_id          = var.apple_team_id
    key_id           = var.apple_key_id
    private_key      = var.apple_private_key
    authorize_scopes = "email name"
  }

  # Apple returns the name on the FIRST authorisation only, and with Hide My
  # Email never again (§3.2). Mapping it here is what gives the Post
  # Confirmation trigger something to capture; without the mapping the claim
  # arrives and is discarded.
  attribute_mapping = {
    email    = "email"
    name     = "name"
    username = "sub"
  }

  lifecycle {
    # Terraform cannot read the key back, so every plan would otherwise propose
    # rewriting it. Changing the key means removing this line deliberately.
    ignore_changes = [provider_details["private_key"]]
  }
}

resource "aws_cognito_identity_provider" "google" {
  count = local.google_ready ? 1 : 0

  user_pool_id  = aws_cognito_user_pool.main.id
  provider_name = "Google"
  provider_type = "Google"

  provider_details = {
    client_id        = var.google_client_id
    client_secret    = var.google_client_secret
    authorize_scopes = "openid email profile"
  }

  attribute_mapping = {
    email          = "email"
    email_verified = "email_verified"
    name           = "name"
    username       = "sub"
  }

  lifecycle {
    ignore_changes = [provider_details["client_secret"]]
  }
}
