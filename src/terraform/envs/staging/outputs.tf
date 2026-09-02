output "table_name" {
  value = module.data.table_name
}

output "table_arn" {
  value = module.data.table_arn
}

output "table_stream_arn" {
  value = module.data.table_stream_arn
}

output "ci_plan_role_arn" {
  description = "Set as the AWS_PLAN_ROLE_ARN repository variable in GitHub."
  value       = module.github_oidc.plan_role_arn
}

output "ci_apply_role_arn" {
  description = "Set as AWS_APPLY_ROLE_ARN in the matching GitHub Environment."
  value       = module.github_oidc.apply_role_arn
}
