output "zone_id" {
  description = "For records and for ACM's DNS validation."
  value       = aws_route53_zone.env.zone_id
}

output "zone_name" {
  description = "The zone's name, as delegated."
  value       = aws_route53_zone.env.name
}

output "name_servers" {
  description = <<-EOT
    The four name servers to delegate to. Add these as an NS record for
    <zone_name> in the root account's hosted zone; nothing under this zone
    resolves until you do.
  EOT
  value       = aws_route53_zone.env.name_servers
}
