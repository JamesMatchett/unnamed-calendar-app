# ---------------------------------------------------------------------------
# This environment's DNS zone, delegated from the root account.
#
# The domain is registered in the root account and stays there. Each environment
# gets a subdomain zone in its OWN account, and the root account carries NS
# records pointing at it. That is what keeps a dev apply from being able to touch
# production DNS: the credentials that can write this zone cannot write the
# parent.
#
# The delegation itself is a manual step, once per environment, and deliberately
# so. Terraform here has no credentials for the root account, and giving it some
# would defeat the separation the arrangement exists for. Apply this, read
# `name_servers` from the output, and add the NS record in the root account by
# hand.
#
# Until that record exists the zone resolves for nobody. That is harmless: it
# holds no records yet, and nothing in this slice depends on it. The certificate
# and the custom domain come next, and those DO depend on it, which is why the
# zone is created now rather than then — DNS delegation propagates on its own
# schedule and is better started early than discovered late.
# ---------------------------------------------------------------------------

resource "aws_route53_zone" "env" {
  name    = var.zone_name
  comment = "Cal&der ${var.environment}. Delegated from the root account."

  lifecycle {
    # Recreating a zone issues four new name servers, which means the delegation
    # in the root account silently stops matching and every name under it stops
    # resolving until somebody notices and copies the new values across.
    prevent_destroy = true
  }
}
