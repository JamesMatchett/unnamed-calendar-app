output "user_pool_id" {
  description = "The user pool. Its issuer URL is what the API's JWT authoriser trusts."
  value       = aws_cognito_user_pool.main.id
}

output "user_pool_arn" {
  description = "For the Lambda triggers that will read and write this pool."
  value       = aws_cognito_user_pool.main.arn
}

output "user_pool_endpoint" {
  description = "Host form, without a scheme. The issuer is https://<this>."
  value       = aws_cognito_user_pool.main.endpoint
}

output "app_client_id" {
  description = "The mobile app's client. This is the `aud` the API's authoriser accepts."
  value       = aws_cognito_user_pool_client.app.id
}

output "test_client_id" {
  description = <<-EOT
    The admin-password client, when enabled. Null everywhere it is not. Use it to
    mint a token for /v1/me until Apple and Google federation exists; see the
    Terraform README.
  EOT
  value       = one(aws_cognito_user_pool_client.test[*].id)
}

output "audiences" {
  description = <<-EOT
    Every client id a token may be issued to, which is exactly what the API's JWT
    authoriser accepts as `aud`. Derived rather than passed, so that enabling the
    test client cannot leave the authoriser rejecting the only token available.
  EOT
  value       = compact([aws_cognito_user_pool_client.app.id, one(aws_cognito_user_pool_client.test[*].id)])
}

output "trigger_function_name" {
  description = "The Pre Token Generation function, for logs when a sign-in fails."
  value       = aws_lambda_function.trigger.function_name
}
