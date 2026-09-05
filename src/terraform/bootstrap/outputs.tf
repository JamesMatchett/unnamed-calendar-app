output "state_bucket_name" {
  description = "Put this in the matching envs/<environment>/backend.tf."
  value       = aws_s3_bucket.state.id
}

output "state_bucket_arn" {
  description = "Pass to the github-oidc module as state_bucket_arn."
  value       = aws_s3_bucket.state.arn
}

output "account_id" {
  description = "Account this environment lives in. Set as allowed_account_ids in the env root."
  value       = data.aws_caller_identity.current.account_id
}
