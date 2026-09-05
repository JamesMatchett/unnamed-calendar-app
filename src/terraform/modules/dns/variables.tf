variable "zone_name" {
  description = <<-EOT
    The fully qualified name of this environment's zone, e.g. dev.calandder.com.

    A delegated subdomain rather than the apex. The apex stays with the site: it
    serves /join, /add, /get and .well-known/apple-app-site-association, and a
    universal link only works from the domain the association file is served
    from. Production's API therefore becomes api.calandder.com, never the apex
    itself.
  EOT
  type        = string
}

variable "environment" {
  description = "Environment name, used only in the zone's comment."
  type        = string
}
