output "plan_role_arn" {
  description = "Role assumed by the plan workflow."
  value       = aws_iam_role.plan.arn
}

output "apply_role_arn" {
  description = "Role assumed by the apply workflow, gated on a GitHub Environment."
  value       = aws_iam_role.apply.arn
}
