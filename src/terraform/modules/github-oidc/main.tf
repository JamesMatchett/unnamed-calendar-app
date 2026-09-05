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

  # The repository half of the subject claim, in GitHub's immutable form:
  #
  #   repo:OWNER@OWNER_ID/REPO@REPO_ID
  #
  # rather than the repo:OWNER/REPO that every example still shows. A
  # repository created after 15 July 2026 mints this by default, and a rename
  # or transfer after that date moves an older one onto it. The numeric ids are
  # the control and the names are decoration: a name can be given up and taken
  # by somebody else, and the point of the ids is that the stranger who takes
  # it cannot then mint a token this account already trusts.
  #
  # The ids are threaded in rather than derived, because nothing in Terraform
  # can look them up without a GitHub credential, and a security boundary that
  # depends on a lookup is a security boundary that fails open.
  #
  # This is what CI's first "Not authorized to perform
  # sts:AssumeRoleWithWebIdentity" meant. AWS answers a missing role, a wrong
  # account id, an audience the provider does not accept and a subject that
  # does not match with that one sentence, and will not say which, so from the
  # outside all four look identical — and every condition here was individually
  # correct. The failure diagnostic in terraform-plan.yml exists because of it:
  # it prints the claim GitHub actually sent, which is the only thing that
  # tells the four apart.
  repo_owner = split("/", var.github_repository)[0]
  repo_name  = split("/", var.github_repository)[1]
  subject    = "repo:${local.repo_owner}@${var.github_owner_id}/${local.repo_name}@${var.github_repository_id}"
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
      values   = ["${local.subject}:*"]
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

# --- what "read-only" is allowed to mean --------------------------------------

# ReadOnlyAccess grants far more than describing infrastructure. It reads
# DynamoDB items, S3 object contents, Secrets Manager values and SSM parameters:
# the data, not just the shape of the thing holding it. That is a poor fit for a
# role assumable from ANY pull request on this repository, including one opened
# by Dependabot proposing a new version of a third-party action, whose code then
# runs in the job that holds these credentials.
#
# So keep the managed policy for the refresh, and take back the reads that
# matter. Deny beats Allow unconditionally in IAM, so this holds no matter what
# ReadOnlyAccess grows to cover — which is the point of doing it this way rather
# than replacing the policy with a hand-written allow-list. An allow-list is
# genuinely least privilege and genuinely brittle: every resource type added
# later fails the plan with AccessDenied, and the fix, made in a hurry, is
# always to widen it.
#
# The honest limitation: this is not least privilege. A service added later
# whose data-read API is not named below stays readable, and nothing here will
# say so. Adding a data store means adding it to this list.
#
# Only the plan role. The apply role carries PowerUserAccess and could create a
# Lambda that reads the table anyway, so denying it item reads would be theatre.
# The plan role is the one whose whole promise is that it cannot touch anything,
# and this is what makes "read-only" mean read the configuration, not the
# contents.
data "aws_iam_policy_document" "plan_no_data" {
  statement {
    sid    = "NoItemReads"
    effect = "Deny"
    actions = [
      "dynamodb:GetItem",
      "dynamodb:BatchGetItem",
      "dynamodb:Query",
      "dynamodb:Scan",
      "dynamodb:PartiQLSelect",
      "dynamodb:GetRecords",
      "dynamodb:ExportTableToPointInTime",
    ]
    resources = ["*"]
  }

  statement {
    sid    = "NoSecretValues"
    effect = "Deny"
    actions = [
      "secretsmanager:GetSecretValue",
      "secretsmanager:BatchGetSecretValue",
      "ssm:GetParameter",
      "ssm:GetParameters",
      "ssm:GetParameterHistory",
      "ssm:GetParametersByPath",
      # Describing a key stays allowed; using one does not. The state bucket is
      # SSE-S3, so nothing a plan does needs this.
      "kms:Decrypt",
      "kms:GenerateDataKey",
      "kms:GenerateDataKeyWithoutPlaintext",
    ]
    resources = ["*"]
  }

  statement {
    sid    = "NoUserData"
    effect = "Deny"
    actions = [
      "cognito-idp:AdminGetUser",
      "cognito-idp:ListUsers",
      "cognito-idp:ListUsersInGroup",
      "cognito-idp:AdminListGroupsForUser",
      "cognito-idp:AdminListUserAuthEvents",
      "cognito-identity:*",
    ]
    resources = ["*"]
  }

  # Terraform reads state from this bucket and writes a lock beside it, so the
  # state prefix is the one place object reads stay allowed. Everything else in
  # the account is denied, including buckets that do not exist yet.
  statement {
    sid    = "NoObjectContentsExceptState"
    effect = "Deny"
    actions = [
      "s3:GetObject",
      "s3:GetObjectVersion",
    ]
    not_resources = ["${var.state_bucket_arn}/*"]
  }

  # Describing a log group is infrastructure; what people logged in it is not.
  statement {
    sid    = "NoLogContents"
    effect = "Deny"
    actions = [
      "logs:GetLogEvents",
      "logs:FilterLogEvents",
      "logs:StartQuery",
      "logs:GetQueryResults",
    ]
    resources = ["*"]
  }

  # The escalation this arrangement would otherwise still allow: nothing stops a
  # read-only role from being a stepping stone to a role that is not. Terraform
  # here never assumes a second role, so denying it costs nothing and closes it.
  statement {
    sid    = "NoRoleChaining"
    effect = "Deny"
    actions = [
      "sts:AssumeRole",
      "sts:AssumeRoleWithWebIdentity",
      "sts:AssumeRoleWithSAML",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "plan_no_data" {
  name   = "no-data-reads"
  role   = aws_iam_role.plan.id
  policy = data.aws_iam_policy_document.plan_no_data.json
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
      values   = ["${local.subject}:environment:${var.environment}"]
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

# Reading IAM, though, it must be able to do — and PowerUserAccess cannot.
# Its first statement is NotAction on iam:*, and the second adds back only
# CreateServiceLinkedRole, DeleteServiceLinkedRole and ListRoles. GetRole,
# GetRolePolicy, ListAttachedRolePolicies and GetOpenIDConnectProvider are all
# denied.
#
# That matters because the provider and both of these roles live in the same
# state file as everything else in the environment, and `terraform apply`
# refreshes state before it plans. Without this, every apply fails reading
# resources it was never going to change: the floor above would have blocked CI
# from running at all rather than from changing IAM.
#
# It grants nothing new. The plan role carries ReadOnlyAccess, which already
# includes every IAM read there is, and both roles are assumable from this one
# repository — so this is the same access through a second door, not a wider
# door. Writes stay denied, which is the part that was meant to be a floor: a
# change to this module plans clean and then fails at apply, deliberately, and
# has to be applied by a human.
data "aws_iam_policy_document" "apply_read_iam" {
  statement {
    effect = "Allow"
    actions = [
      "iam:Get*",
      "iam:List*",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "apply_read_iam" {
  name   = "read-iam"
  role   = aws_iam_role.apply.id
  policy = data.aws_iam_policy_document.apply_read_iam.json
}

resource "aws_iam_role_policy" "apply_state" {
  name   = "terraform-state"
  role   = aws_iam_role.apply.id
  policy = data.aws_iam_policy_document.state_access.json
}
