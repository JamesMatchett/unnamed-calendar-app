# ---------------------------------------------------------------------------
# The HTTP API, one Lambda behind it, and the pool's JWT authoriser.
#
# See Architecture.md §3.3. HTTP API rather than REST API ($1.00 per million
# requests against $3.50, and lower latency), arm64 for roughly 20% off per
# GB-second, Node 22 with an esbuild bundle.
#
# Two routes, with different requirements on purpose:
#
#   GET /v1/health  no authoriser. If this fails, the fault is the API, the
#                   integration or the function, and identity is not involved.
#   GET /v1/me      the authoriser. A 401 here beside a 200 on health isolates
#                   the authoriser and nothing else.
#
# The authoriser is API Gateway's own JWT validation, not a Lambda authoriser:
# no cold start and no extra invocation on every request (§3.3).
#
# DEPLOYMENT: Terraform owns the bundle here, which reverses what §3.6 wrote.
# That section splits infrastructure from code so a deploy is not a state apply,
# on the reasoning that "infrastructure changes weekly; application code changes
# hourly". True later. Today there is one route, the infrastructure is what is
# moving, and the split would cost this slice its whole point: with
# ignore_changes on the code, `terraform apply` ships an empty function and
# proves nothing until a second pipeline runs. Revisit when deploys outpace
# infrastructure changes, or the first time a rollback needs to not be an apply.
# ---------------------------------------------------------------------------

locals {
  name = "${var.project}-${var.environment}-api"
}

# --- the artifact -----------------------------------------------------------

data "archive_file" "bundle" {
  type        = "zip"
  source_dir  = var.bundle_dir
  output_path = "${path.module}/.build/${var.environment}-bundle.zip"
}

# --- execution role ---------------------------------------------------------

data "aws_iam_policy_document" "assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "lambda" {
  name               = "${local.name}-lambda"
  description        = "Execution role for the ${local.name} function"
  assume_role_policy = data.aws_iam_policy_document.assume.json
}

# The managed basic execution policy grants only CreateLogGroup, CreateLogStream
# and PutLogEvents. The log group itself is declared below rather than left to
# Lambda to create, because a group Lambda creates has no retention and keeps
# every line for ever.
resource "aws_iam_role_policy_attachment" "lambda_basic" {
  role       = aws_iam_role.lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

data "aws_iam_policy_document" "table_access" {
  statement {
    effect = "Allow"
    actions = [
      "dynamodb:GetItem",
      "dynamodb:BatchGetItem",
      "dynamodb:Query",
      "dynamodb:PutItem",
      "dynamodb:UpdateItem",
      "dynamodb:DeleteItem",
      "dynamodb:BatchWriteItem",
      "dynamodb:ConditionCheckItem",
    ]
    # The table and its indexes. Scan is absent: every access pattern in §4.4 is
    # a Query, and a Scan that reaches production is a design mistake that should
    # surface as an error rather than as a bill.
    resources = [var.table_arn, "${var.table_arn}/index/*"]
  }

  # An encrypted table refuses reads without this, with an error that names KMS
  # and not DynamoDB.
  statement {
    effect = "Allow"
    actions = [
      "kms:Decrypt",
      "kms:GenerateDataKey",
    ]
    resources = [var.table_kms_key_arn]
  }
}

resource "aws_iam_role_policy" "table_access" {
  name   = "table-access"
  role   = aws_iam_role.lambda.id
  policy = data.aws_iam_policy_document.table_access.json
}

# --- the function -----------------------------------------------------------

# Declared, not left to Lambda. Lambda creates a group on first invocation with
# retention set to Never Expire, and a group that already exists is left alone.
resource "aws_cloudwatch_log_group" "lambda" {
  name              = "/aws/lambda/${local.name}"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "api" {
  function_name = local.name
  role          = aws_iam_role.lambda.arn

  filename         = data.archive_file.bundle.output_path
  source_code_hash = data.archive_file.bundle.output_base64sha256

  # index.mjs, bundled ESM. The .mjs extension is what makes Node treat it as a
  # module regardless of any package.json, and there is no package.json in the
  # zip: the bundle carries its dependencies rather than resolving them.
  handler = "index.handler"
  runtime = "nodejs22.x"

  # arm64 is cheaper per GB-second for identical code (§3.3). Nothing here is
  # architecture-specific, since the bundle is JavaScript.
  architectures = ["arm64"]

  # 512 MB rather than the 128 MB default: CPU is allocated in proportion to
  # memory, so a larger setting is often both faster and cheaper for short
  # invocations. Worth measuring against real handlers before treating as final.
  memory_size = 512
  timeout     = 10

  environment {
    variables = {
      CALDER_ENVIRONMENT = var.environment
      CALDER_COMMIT      = var.commit
      CALDER_TABLE       = var.table_name
      # Ask the SDK to reuse connections between invocations. Off by default in
      # older runtimes and free to set.
      AWS_NODEJS_CONNECTION_REUSE_ENABLED = "1"
    }
  }

  # Without this the function can run before its log group exists, and Lambda
  # then creates the group itself with no retention, leaving the declaration
  # above fighting a group it did not make.
  depends_on = [
    aws_cloudwatch_log_group.lambda,
    aws_iam_role_policy_attachment.lambda_basic,
  ]
}

# --- the API ----------------------------------------------------------------

resource "aws_apigatewayv2_api" "main" {
  name          = local.name
  protocol_type = "HTTP"
  description   = "Cal&der ${var.environment} API"
}

resource "aws_apigatewayv2_integration" "lambda" {
  api_id = aws_apigatewayv2_api.main.id

  integration_type = "AWS_PROXY"
  integration_uri  = aws_lambda_function.api.invoke_arn

  # Explicit, not defaulted. The handler reads `routeKey`, which format 1.0 does
  # not send, so a mismatch here makes every route answer 404 and look like a
  # routing mistake rather than a payload one.
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_authorizer" "jwt" {
  api_id = aws_apigatewayv2_api.main.id

  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"]
  name             = "${local.name}-jwt"

  jwt_configuration {
    # Every client id a token may carry. Rejecting an unexpected `aud` is the
    # difference between "a valid token from our pool" and "a valid token".
    audience = var.audiences
    issuer   = var.issuer
  }
}

resource "aws_apigatewayv2_route" "health" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "GET /v1/health"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"

  # No authorizer_id. Stated as an absence rather than left to the default so
  # that a reader can see the route is public on purpose.
  authorization_type = "NONE"
}

resource "aws_apigatewayv2_route" "me" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "GET /v1/me"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"

  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.jwt.id
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.main.id
  name        = "$default"
  auto_deploy = true

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.access.arn

    # One JSON object per request. `authorizerError` is the field that says why
    # a 401 happened, and it is the reason these logs exist at all: without it
    # a rejected token and a missing one look identical from outside.
    format = jsonencode({
      requestId       = "$context.requestId"
      httpMethod      = "$context.httpMethod"
      path            = "$context.path"
      routeKey        = "$context.routeKey"
      status          = "$context.status"
      responseLength  = "$context.responseLength"
      integrationLat  = "$context.integrationLatency"
      responseLat     = "$context.responseLatency"
      authorizerError = "$context.authorizer.error"
      errorMessage    = "$context.error.message"
    })
  }

  default_route_settings {
    # A throttle is a cost control as much as an availability one: an
    # unthrottled public route plus a pay-per-request table is an open invitation
    # to spend money. Generous for a health check, low enough to notice.
    throttling_burst_limit = 100
    throttling_rate_limit  = 50
  }
}

resource "aws_cloudwatch_log_group" "access" {
  name              = "/aws/apigateway/${local.name}"
  retention_in_days = var.log_retention_days
}

# API Gateway invokes the function as a service principal, so the permission
# lives on the function rather than in the execution role.
resource "aws_lambda_permission" "api" {
  statement_id  = "AllowExecutionFromAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api.function_name
  principal     = "apigateway.amazonaws.com"

  # Scoped to this API, so another API in the same account cannot invoke it.
  source_arn = "${aws_apigatewayv2_api.main.execution_arn}/*/*"
}
