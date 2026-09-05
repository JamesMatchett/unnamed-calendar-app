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

output "api_url" {
  description = "The stable base URL, and the one a build should carry."
  value       = module.api.api_url
}

output "api_endpoint" {
  description = <<-EOT
    The generated execute-api URL. Still the quickest thing to curl, and useful
    for telling "the API is broken" apart from "the custom domain is broken",
    but never the URL to put in a build.
  EOT
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

output "trigger_function_name" {
  description = "The Pre Token Generation function. Its log group is where a failed sign-in explains itself."
  value       = module.auth.trigger_function_name
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
