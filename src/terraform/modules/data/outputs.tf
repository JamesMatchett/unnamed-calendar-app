output "table_name" {
  description = "Name of the single-table DynamoDB store."
  value       = aws_dynamodb_table.main.name
}

output "table_arn" {
  description = "ARN of the table, for IAM policies on the API and stream consumers."
  value       = aws_dynamodb_table.main.arn
}

output "table_stream_arn" {
  description = "Stream ARN consumed by the fan-out Lambda (§5.1, §7.3)."
  value       = aws_dynamodb_table.main.stream_arn
}

output "gsi1_arn" {
  description = "ARN of GSI1, for IAM policies that must grant Query on the index."
  value       = "${aws_dynamodb_table.main.arn}/index/GSI1"
}

output "kms_key_arn" {
  description = "CMK protecting the table."
  value       = aws_kms_key.table.arn
}
