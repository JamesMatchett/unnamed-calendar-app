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

output "api_endpoint" {
  description = "Base URL. GET <this>/v1/health answers 200 with no token; /v1/me answers 401 without one."
  value       = module.api.api_endpoint
}

output "api_function_name" {
  description = "The Lambda, for logs and direct invocation."
  value       = module.api.function_name
}

output "user_pool_id" {
  value = module.auth.user_pool_id
}

output "app_client_id" {
  description = "The mobile app's Cognito client."
  value       = module.auth.app_client_id
}

output "test_client_id" {
  description = "The admin-password client, or null where it is not enabled."
  value       = module.auth.test_client_id
}

output "dns_name_servers" {
  description = <<-EOT
    Add these as an NS record for the zone in the ROOT account's calandder.com
    zone. Nothing under this zone resolves until you do, and that step is manual
    on purpose: Terraform here holds no credentials for the root account.
  EOT
  value       = module.dns.name_servers
}
