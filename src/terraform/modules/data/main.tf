# ---------------------------------------------------------------------------
# The single DynamoDB table.
#
# See Architecture.md §4.2 (key schema), §4.3 (attributes) and §5.5 (recurrence).
#
# ONE-WAY DOOR: the base table's hash_key and range_key cannot be changed on a
# live table. Altering them means creating a new table and migrating every item.
# Indexes can be added and removed later; this cannot.
# ---------------------------------------------------------------------------

locals {
  name = "${var.project}-${var.environment}-main"
}

resource "aws_kms_key" "table" {
  description             = "CMK for the ${local.name} DynamoDB table"
  enable_key_rotation     = true
  deletion_window_in_days = var.kms_deletion_window_days
}

resource "aws_kms_alias" "table" {
  name          = "alias/${local.name}"
  target_key_id = aws_kms_key.table.key_id
}

resource "aws_dynamodb_table" "main" {
  name         = local.name
  billing_mode = "PAY_PER_REQUEST"

  hash_key  = "PK"
  range_key = "SK"

  # Only KEY attributes are declared. DynamoDB is schemaless otherwise: every
  # non-key attribute in Architecture.md §4.3 exists at write time and is never
  # named here. This is why the "share types with the infrastructure" argument
  # for CDK was weak for this stack (§3.6).
  attribute {
    name = "PK"
    type = "S"
  }

  attribute {
    name = "SK"
    type = "S"
  }

  attribute {
    name = "GSI1PK"
    type = "S"
  }

  attribute {
    name = "GSI1SK"
    type = "S"
  }

  # GSI1 serves four access patterns (§4.4): my calendars (1), events in a date
  # window (4), my upcoming events (13) and recurring series (17). It is sparse:
  # items without GSI1PK/GSI1SK do not appear at all, which is how a departed
  # member's calendar drops out of their list without deleting the item (§8.4).
  #
  # The projection is deliberately narrow. Every GSI write is billed as an extra
  # write, and a fat projection is the classic way a DynamoDB bill doubles
  # quietly (§4.2). Changing it later replaces the index.
  global_secondary_index {
    name            = "GSI1"
    hash_key        = "GSI1PK"
    range_key       = "GSI1SK"
    projection_type = "INCLUDE"

    non_key_attributes = [
      "entityType",
      "name",
      "title",
      "mode",
      "startDate",
      "endDate",
      "startUtc",
      "endUtc",
      "tz",
      "precision",
      "status",
      "rrule",
      "updatedAt",
    ]
  }

  # ONE attribute name for every expiry in the system: invite tokens,
  # notifications, change-log entries, delete tombstones and soft-deleted
  # calendars. DynamoDB permits exactly one TTL attribute per table, so they all
  # write different values to this same field. (memory.md, trap 4.)
  ttl {
    attribute_name = "expiresAt"
    enabled        = true
  }

  # Feeds the fan-out consumer: change-log sequence numbers, push notifications
  # and inbox items (§5.1, §7.3).
  stream_enabled   = true
  stream_view_type = "NEW_AND_OLD_IMAGES"

  point_in_time_recovery {
    enabled = true
  }

  server_side_encryption {
    enabled     = true
    kms_key_arn = aws_kms_key.table.arn
  }

  deletion_protection_enabled = var.deletion_protection

  lifecycle {
    # Terraform does not allow variables in lifecycle blocks, so this holds in
    # every environment including dev. Genuinely destroying a dev table means
    # commenting this out in a commit. That friction is deliberate: this table
    # is the one resource in the system whose loss is unrecoverable.
    prevent_destroy = true
  }
}
