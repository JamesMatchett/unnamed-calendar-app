variable "project" {
  description = "Short project prefix used in resource names."
  type        = string
}

variable "environment" {
  description = "Environment name (dev | staging | prod)."
  type        = string

  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "environment must be one of: dev, staging, prod."
  }
}

variable "deletion_protection" {
  description = <<-EOT
    Deletion protection on the user pool. Losing a pool is unrecoverable: every
    `sub` disappears and every membership row in DynamoDB is orphaned with no way
    to reconnect a person to their calendars (§3.2). Keep true everywhere except a
    dev pool with no real users in it.
  EOT
  type        = bool
  default     = true
}

variable "refresh_token_days" {
  description = <<-EOT
    Refresh token lifetime. Cognito defaults to 30 days, which is too short for an
    offline-first app: someone on a long trip should not routinely drop into the
    read-only mode of §5.6 because their token expired while they were away from a
    network. Access and ID tokens stay at the default hour.
  EOT
  type        = number
  default     = 180
}

variable "test_client_enabled" {
  description = <<-EOT
    Creates a second app client that allows admin password authentication, so a
    real token can be minted with the AWS CLI.

    v1 has no passwords (§3.2, §8.6) and the app's own client never gets this. It
    exists because Apple and Google credentials do not, and without it the JWT
    authoriser can only be shown to REJECT an unauthenticated call. Proving that
    it ACCEPTS a valid one needs a token from somewhere, and this is the only
    somewhere until federation is configured.

    Defaults false. Turn it on in dev, never anywhere with a real user in it, and
    delete it once Apple and Google are wired up.
  EOT
  type        = bool
  default     = false
}

variable "bundle_dir" {
  description = <<-EOT
    The built Lambda bundle, the same artifact modules/api ships. One zip, two
    functions, different handlers: there is one build, one version, and no way
    for the routes and the pool trigger to drift apart.
  EOT
  type        = string
}

variable "table_name" {
  description = "The table holding the IDENTITY#{sub} mapping the trigger reads and writes."
  type        = string
}

variable "table_arn" {
  description = "The table, for the trigger role's grants."
  type        = string
}

variable "table_kms_key_arn" {
  description = "The table's CMK. Without kms permissions every read fails naming KMS, not DynamoDB."
  type        = string
}

variable "log_retention_days" {
  description = "CloudWatch log retention for the trigger."
  type        = number
  default     = 14
}

variable "domain_prefix" {
  description = <<-EOT
    The Cognito-hosted domain, giving <prefix>.auth.<region>.amazoncognito.com.
    Must be unique across the region, so a taken prefix fails the apply with a
    name it will happily tell you about.

    Not a custom domain, deliberately. A custom Cognito domain needs its ACM
    certificate in us-east-1 whatever region the pool is in, because it is
    fronted by CloudFront, AND an A record on the PARENT domain — Cognito
    resolves dev.calandder.com to check the domain is not being hijacked, and an
    SOA is not enough. None of that buys anything in dev. §3.2's argument that
    *.amazoncognito.com costs conversion is about people signing up, so it
    applies to prod, where a custom domain is worth the work.
  EOT
  type        = string
}

variable "callback_urls" {
  description = <<-EOT
    Exactly where Cognito will return to after a sign-in. No wildcards: Cognito
    matches these strings exactly, which is why dev carries more than one.

    `calandder://auth` is what a real build uses, standalone or a dev client,
    because that is when the app's URL scheme is registered with the OS.
    Expo Go does not register it and mints an exp:// URL from the machine's
    address instead, so the simulator's loopback form is here too. It is stable
    for the simulator and useless for a phone, which is the honest state of
    testing OAuth in Expo Go.
  EOT
  type        = list(string)
}

# --- federation, which stays off until there are credentials -----------------
#
# Every one of these defaults to empty and each provider is created only when
# its values are present. That means this module applies cleanly today, before
# Apple and Google are configured, and lights up when they are — rather than
# being a half-built thing that fails until somebody finishes it.
#
# NONE of these belong in a committed tfvars. Pass them at apply time:
#
#   export TF_VAR_apple_private_key="$(cat ~/Downloads/AuthKey_XXXXXXXXXX.p8)"
#
# The key is in Terraform state either way (decision recorded in §3.2): the
# point of keeping it out of the repository is that a file in git is forever and
# readable by anyone who ever clones it.

variable "apple_services_id" {
  description = "Apple Services ID, e.g. com.calandder.signin. NOT the bundle id."
  type        = string
  default     = ""
}

variable "apple_team_id" {
  description = "Apple Team ID, ten characters, from Membership details."
  type        = string
  default     = ""
}

variable "apple_key_id" {
  description = "Key ID of the Sign in with Apple key."
  type        = string
  default     = ""
}

variable "apple_private_key" {
  description = "Contents of the .p8. Pass via TF_VAR_apple_private_key; never commit it."
  type        = string
  default     = ""
  sensitive   = true
}

variable "google_client_id" {
  description = "OAuth 2.0 web client id from the Google Cloud console."
  type        = string
  default     = ""
}

variable "google_client_secret" {
  description = "Its secret. Pass via TF_VAR_google_client_secret; never commit it."
  type        = string
  default     = ""
  sensitive   = true
}
