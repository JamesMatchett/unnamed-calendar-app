# ---------------------------------------------------------------------------
# GitHub Actions authenticates to AWS by OIDC. No long-lived access keys exist
# anywhere in this project — see Architecture.md §9.
#
# Two roles per environment:
#   plan   — read-only on AWS, read/write on the state bucket (a plan takes a lock)
#   apply  — the role that actually changes infrastructure
#
# They are separated because the plan role is assumable from any pull request,
# including one opened by a fork or by a compromised contributor. The apply role
# is assumable only from a protected GitHub Environment, so a human approval sits
# between a merged commit and a production change.
# ---------------------------------------------------------------------------

data "aws_caller_identity" "current" {}

locals {
  oidc_host = "token.actions.githubusercontent.com"
  oidc_arn  = var.create_oidc_provider ? aws_iam_openid_connect_provider.github[0].arn : "arn:aws:iam::${data.aws_caller_identity.current.account_id}:oidc-provider/${local.oidc_host}"
}

resource "aws_iam_openid_connect_provider" "github" {
  count = var.create_oidc_provider ? 1 : 0

  url            = "https://${local.oidc_host}"
  client_id_list = ["sts.amazonaws.com"]

  # thumbprint_list is deliberately omitted. AWS validates GitHub's certificate
  # chain against its own trusted CAs, so the thumbprint is no longer
  # load-bearing, and hard-coding one means an outage when GitHub rotates its
  # certificate. If the provider version in use still requires the field, supply
  # GitHub's current thumbprint rather than the all-f placeholder that circulates.
}

# --- plan role -------------------------------------------------------------

data "aws_iam_policy_document" "plan_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [local.oidc_arn]
    }

    condition {
      test     = "StringEquals"
      variable = "${local.oidc_host}:aud"
      values   = ["sts.amazonaws.com"]
    }

    # Any pull request or push on this repository may plan. It cannot change
    # anything: the role carries ReadOnlyAccess plus state-bucket access only.
    condition {
      test     = "StringLike"
      variable = "${local.oidc_host}:sub"
      values   = ["repo:${var.github_repository}:*"]
    }
  }
}

resource "aws_iam_role" "plan" {
  name               = "${var.project}-${var.environment}-ci-plan"
  description        = "GitHub Actions: terraform plan (read-only)"
  assume_role_policy = data.aws_iam_policy_document.plan_assume.json
}

resource "aws_iam_role_policy_attachment" "plan_readonly" {
  role       = aws_iam_role.plan.name
  policy_arn = "arn:aws:iam::aws:policy/ReadOnlyAccess"
}

data "aws_iam_policy_document" "state_access" {
  statement {
    effect    = "Allow"
    actions   = ["s3:ListBucket", "s3:GetBucketVersioning"]
    resources = [var.state_bucket_arn]
  }

  # PutObject and DeleteObject are required even for a plan: the S3 backend
  # writes and removes a lock file (use_lockfile) around every operation.
  statement {
    effect    = "Allow"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = ["${var.state_bucket_arn}/*"]
  }
}

resource "aws_iam_role_policy" "plan_state" {
  name   = "terraform-state"
  role   = aws_iam_role.plan.id
  policy = data.aws_iam_policy_document.state_access.json
}

# --- apply role ------------------------------------------------------------

data "aws_iam_policy_document" "apply_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [local.oidc_arn]
    }

    condition {
      test     = "StringEquals"
      variable = "${local.oidc_host}:aud"
      values   = ["sts.amazonaws.com"]
    }

    # Scoped to a GitHub Environment, not a branch. Environments carry required
    # reviewers; branches do not. This is what puts a human in front of prod.
    condition {
      test     = "StringEquals"
      variable = "${local.oidc_host}:sub"
      values   = ["repo:${var.github_repository}:environment:${var.environment}"]
    }
  }
}

resource "aws_iam_role" "apply" {
  name               = "${var.project}-${var.environment}-ci-apply"
  description        = "GitHub Actions: terraform apply"
  assume_role_policy = data.aws_iam_policy_document.apply_assume.json
}

# TODO(v1): replace with a least-privilege policy once the resource set has
# settled. PowerUserAccess cannot manage IAM, which is a deliberate floor: role
# and policy changes stay a manual, reviewed act rather than something CI can do
# to itself.
resource "aws_iam_role_policy_attachment" "apply_power" {
  role       = aws_iam_role.apply.name
  policy_arn = "arn:aws:iam::aws:policy/PowerUserAccess"
}

resource "aws_iam_role_policy" "apply_state" {
  name   = "terraform-state"
  role   = aws_iam_role.apply.id
  policy = data.aws_iam_policy_document.state_access.json
}
