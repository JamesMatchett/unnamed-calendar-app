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
  # Nothing needs storing: the workflows build this ARN from the project prefix,
  # the environment and AWS_ACCOUNT_ID_<ENV>. It is output so it can be compared
  # against what CI tried to assume when a run fails to authenticate.
  description = "The role CI assumes to plan. Built by convention, not configured."
  value       = module.github_oidc.plan_role_arn
}

output "ci_apply_role_arn" {
  # Also by convention. What DOES have to exist in GitHub is an Environment
  # named for this environment: the trust policy requires environment:<name> in
  # the OIDC subject, so an apply without one fails at the point of assuming.
  description = "The role CI assumes to apply. Built by convention, not configured."
  value       = module.github_oidc.apply_role_arn
}
