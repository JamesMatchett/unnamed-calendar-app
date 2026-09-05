output "api_endpoint" {
  description = "Base URL of the API. GET <this>/v1/health should answer 200 with no token."

  # Trimmed because the $default stage's invoke_url ends in a slash, and every
  # use of this is "${api_endpoint}/v1/...". A double slash is a different path
  # to API Gateway, so it answers 404 and looks like a missing route.
  #
  # Taken from the stage rather than from the API so that reading this output
  # depends on the stage existing; the URL itself is the same either way.
  value = trimsuffix(aws_apigatewayv2_stage.default.invoke_url, "/")
}

output "function_name" {
  description = "The Lambda, for reading logs and for aws lambda invoke."
  value       = aws_lambda_function.api.function_name
}

output "log_group" {
  description = "Where the function's own logs go."
  value       = aws_cloudwatch_log_group.lambda.name
}

output "access_log_group" {
  description = "Where the API's per-request logs go, including why a 401 happened."
  value       = aws_cloudwatch_log_group.access.name
}
