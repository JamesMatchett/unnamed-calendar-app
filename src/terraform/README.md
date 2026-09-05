# Infrastructure

Terraform for Cal&der. Design rationale is in [Architecture.md](../../Architecture.md) §3.6;
this file is the operating manual.

```
src/terraform/
  bootstrap/          run once per account, local state — creates the state bucket
  modules/
    data/             the single DynamoDB table (§4.2) + its CMK
    github-oidc/      OIDC provider and the CI plan/apply roles
    auth/             the Cognito user pool and its app clients (§3.2)
    api/              the HTTP API, the Lambda, and the pool's JWT authoriser (§3.3)
    dns/              this environment's delegated Route 53 zone
  envs/
    dev/ staging/ prod/   one root module per environment, one per AWS account
```

**A directory per environment, not Terraform workspaces.** The environments live in
different AWS accounts, and workspaces-as-environments breaks down once accounts rather than
just variable values differ.

## Your local AWS profile

Access is by IAM Identity Center SSO. No access keys, here or anywhere.

Put this in `~/.aws/config`. The `sso-session` block needs AWS CLI 2.9 or newer
(`aws --version`); older versions have no refreshable SSO tokens and want the settings
repeated on every profile.

```ini
[sso-session jmatch]
sso_start_url = https://jmatch.awsapps.com/start
sso_region = eu-north-1
sso_registration_scopes = sso:account:access

[profile calder-dev]
sso_session      = jmatch
sso_account_id   = 392852903961
sso_role_name    = AdministratorAccess   # must be assigned to you first, see below
region           = eu-west-2
output           = json
```

Two things people get wrong here.

**`sso_region` is not `region`.** The first is where the Identity Center *directory* lives,
the second is where this project's resources go. Here they genuinely differ — the directory
is in `eu-north-1` and every resource is in `eu-west-2` — which is why they are two
settings. `aws configure sso` prompts for both, and detects the directory region, if you
would rather answer questions than edit a file.

**The start URL has no `#/`.** What the browser shows is
`https://jmatch.awsapps.com/start/#/`, and everything after the `#` is a fragment the
browser never sends. The CLI wants the URL without it.

Then:

```sh
aws sso login --profile calder-dev
aws sts get-caller-identity --profile calder-dev   # must print 392852903961
export AWS_PROFILE=calder-dev                      # Terraform reads this
```

The account check is not ceremony. Every environment sets `allowed_account_ids`, so
Terraform refuses to run against the wrong account — but it refuses *after* you have
authenticated, and the error is easier to read when you already know which account you are
in.

### The permission set has to be able to do this

`SystemAdministrator` is not enough for the first apply, and the way it fails is piecemeal:
bootstrap succeeds, then the environment apply stops partway through having created some
things and not others.

| Needed by | `SystemAdministrator` |
|---|---|
| `s3:*` — the state bucket | yes |
| `kms:CreateKey` — the table's CMK | yes |
| `kms:TagResource` — because the provider sets `default_tags` | **no** |
| `dynamodb:CreateTable` — the table | **no**, it grants no DynamoDB at all |
| `iam:CreateRole`, `iam:CreateOpenIDConnectProvider` — the CI roles | **no**, read-only on IAM |

Use `AdministratorAccess` for the first apply in an account. After that CI owns applies
through its own roles, so the human permission set only has to be enough to *look* at things
— and note that `SystemAdministrator` cannot read the table either, so it is a poor fit for
this project even then.

Assigning it is a console job, in Identity Center rather than in this repo: **IAM Identity
Center → Permission sets → Create** (`AdministratorAccess` is a predefined one), then **AWS
accounts →** the account **→ Assign users or groups**. Naming it in `~/.aws/config` does not
create it.

### When it says "No access"

```
ForbiddenException ... GetRoleCredentials operation: No access
```

after a login that reported success. The login and the profile fail separately: `aws sso
login` establishes a session with the *portal*, which works as long as you can sign in at
all, and `sso_account_id` + `sso_role_name` are only checked when something asks for
credentials. So this means the portal knows you and that account-and-permission-set pair is
not assigned to you — most often because the config names a permission set that does not
exist yet.

The error does not say which of the two is wrong, so ask the portal what you do have:

```sh
aws configure sso --profile calder-dev
```

It reuses the session you already have and lists the accounts and permission sets actually
available to you, then writes the answers to the file. The browser portal shows the same
list under the account.

## First-time setup, per account

The first apply in an account cannot run in CI, because CI's role is created *by* that
apply. A human does it once with admin credentials.

1. **Create the state bucket.**

   ```sh
   cd src/terraform/bootstrap
   terraform init
   terraform apply -var environment=dev      # then staging, prod, in their accounts
   ```

   Note the three outputs: `state_bucket_name`, `state_bucket_arn`, `account_id`.

2. **Fill in the account id.** In `envs/dev/`, replace `REPLACE_WITH_ACCOUNT_ID` in both
   `backend.tf` and `terraform.tfvars`. It appears twice because an S3 backend block cannot
   take variables, so that bucket name has to be a literal; everything else derives from it.

   `npm run check:infra` verifies the two agree, that the bucket matches what bootstrap
   builds, and that an environment is not left half configured. Run it before `terraform
   init` — the alternative is an error about a bucket rather than about the thing you
   forgot.

3. **First apply, locally.**

   ```sh
   cd src/terraform/envs/dev
   terraform init
   terraform apply
   ```

   This creates the table and the two CI roles.

4. **Wire up GitHub.** From the outputs, set three **repository variables**:
   `AWS_ACCOUNT_ID_DEV`, `AWS_ACCOUNT_ID_STAGING`, `AWS_ACCOUNT_ID_PROD`. The workflows
   build role ARNs by convention (`calder-<env>-ci-plan` / `-ci-apply`), so no role ARNs need
   storing.

   Until an account id is set as a repository variable, that environment's plan and apply
   jobs skip rather than fail, so starting with dev alone does not leave two permanently red
   checks on every pull request.

5. **Create GitHub Environments** named `dev`, `staging` and `prod`. The apply role's trust
   policy requires `environment:<name>` in the OIDC subject, so an apply cannot run without
   them. **Add required reviewers to `prod`** — otherwise production applies unattended,
   which is the one thing this arrangement exists to prevent.

6. **Pin the repository's numeric ids.** `github_owner_id` and `github_repository_id` in
   each `envs/*/variables.tf` are part of the OIDC subject claim and have to match the
   repository CI runs from. They are already set for this one; they only change if the
   repository is recreated, or if this configuration is reused for a different repository.

   GitHub mints the subject in its immutable form:

   ```
   repo:OWNER@OWNER_ID/REPO@REPO_ID:pull_request
   ```

   not the `repo:OWNER/REPO:...` that every guide and every example trust policy still
   shows. Repositories created after 15 July 2026 use it by default, and a rename or
   transfer moves an older one onto it. The ids are the point: a repository name can be
   given up and taken by a stranger, and pinning the name alone would let that stranger
   mint tokens this account already trusts.

   Read them from the `repository_owner_id` and `repository_id` claims on a token, or from
   GitHub's subject-claim preview. If they are wrong, `assume plan role` fails with
   `Not authorized to perform sts:AssumeRoleWithWebIdentity`, which is also what AWS says
   for a missing role, a wrong account id and an audience the provider will not accept.
   It will not tell you which of the four it meant — that is what the `what this job sent`
   step in `terraform-plan.yml` is for. It runs only when the assume fails, and prints the
   claim GitHub actually sent next to the ARN the job actually built.

After that, CI owns it: pull requests plan all three environments, and merges to `main`
apply dev → staging → prod in order.

## The API

Two routes, and they answer different questions on purpose.

```sh
API=$(terraform -chdir=envs/dev output -raw api_endpoint)

curl -s "$API/v1/health"          # 200, and names the environment and commit
curl -si "$API/v1/me" | head -1   # 401 from API Gateway, before Lambda is invoked
```

A 200 on the first and a 401 on the second is the whole slice working: the API, the
integration and the function on one hand, the authoriser on the other. One route could not
tell you that. A single public route passes while the authorised path is broken, and a
single authorised route failing cannot say which of the three failed.

The 401 only proves the authoriser **rejects**. Proving it **accepts** needs a token, and
there is no source of one until Apple and Google federation is configured. `dev` therefore
sets `test_client_enabled = true`, which adds a second app client permitting
`ADMIN_USER_PASSWORD_AUTH`. That flow is server-side only and needs IAM permission on top of
the password, so it is not a password path in front of users; the app's own client never gets
it. Create a user, then:

```sh
POOL=$(terraform -chdir=envs/dev output -raw user_pool_id)
CLIENT=$(terraform -chdir=envs/dev output -raw test_client_id)

aws cognito-idp admin-create-user --user-pool-id "$POOL" \
  --username you@example.com --message-action SUPPRESS --profile calder-dev
aws cognito-idp admin-set-user-password --user-pool-id "$POOL" \
  --username you@example.com --password '<a long one>' --permanent --profile calder-dev

TOKEN=$(aws cognito-idp admin-initiate-auth --user-pool-id "$POOL" \
  --client-id "$CLIENT" --auth-flow ADMIN_USER_PASSWORD_AUTH \
  --auth-parameters USERNAME=you@example.com,PASSWORD='<a long one>' \
  --profile calder-dev --query 'AuthenticationResult.AccessToken' --output text)

curl -s "$API/v1/me" -H "Authorization: Bearer $TOKEN"
```

That answers 200 with the `sub` and a null `userId`. Null is correct for now: the user id is
a ULID minted at first sign-in and injected as a custom claim by a Pre Token Generation
trigger (§3.2), and neither exists yet. **Delete the test client and the user once federation
is in.**

If `/v1/me` ever answers 200 with `"detail": "no verified claims reached the handler"`, the
authoriser has come off the route. That body exists to say so: API Gateway answers 401 itself
while the authoriser is attached, so the handler can only see an unauthenticated request when
the route has been left open.

## DNS

Each environment holds its own zone, in its own account, delegated from the root account
where the domain is registered:

| Environment | Zone |
|---|---|
| dev | `dev.calandder.com` |
| staging | `staging.calandder.com` |
| prod | `api.calandder.com` |

Production's is a subdomain rather than the apex because the apex belongs to the site:
`/join`, `/add`, `/get` and `.well-known/apple-app-site-association` are all served from it,
and a universal link only works from the domain that serves the association file.

**The delegation is manual, once per environment, and deliberately so.** Terraform in a
child account has no credentials for the root account, and giving it some would defeat the
separation the arrangement exists for. After applying:

```sh
terraform -chdir=envs/dev output dns_name_servers
```

and add those four as an `NS` record for the zone in the root account's `calandder.com`
zone. Until then the zone resolves for nobody, which is harmless while it holds no records.
It is created early because delegation propagates on its own schedule, and the certificate
that the custom domain needs cannot be validated until it has.

## Checking before you push

`npm run verify` includes three infrastructure checks, and each says plainly when
it could not do its job rather than passing quietly:

- **`check:infra`** — names agree across Terraform and the workflows, no environment
  is half configured, one region, one Terraform version. Also runs `fmt -check` when
  `terraform` or `tofu` is on PATH.
- **`check:tfvars`** — every `var.x` is declared where it is used, every module argument
  is a variable that module has, every module variable without a default is passed by
  every caller, every `module.name.output` reads something that module actually outputs,
  and every key in a `.tfvars` is a real variable. `terraform validate`
  covers most of this but needs a provider download; this needs nothing, and it catches
  the case validate never reaches, which is a module gaining a required variable that
  only one of the three environments is updated for. dev is planned on every pull
  request. staging and prod are not planned at all until an account exists for them, so
  a gap there stays invisible for months.
- **`check:workflows`** — [actionlint](https://github.com/rhysd/actionlint), if installed
  (`brew install actionlint`).

The second matters more than it looks, and is deliberately *not* run in CI. An
invalid workflow is the one mistake CI cannot catch: GitHub rejects the file rather
than running it, so there is no job and no log, only an annotation with a line
number. Everything else fails somewhere you can read; this fails before there is
anywhere to read, which is why it has to run before the push.

Everything else does run in CI, in `.github/workflows/verify.yml`, on every pull
request. If `npm run verify` reports anything as NOT CHECKED locally, install what
it names — a check that quietly does nothing is worse than no check.

## Conventions

- **No long-lived AWS keys.** Everything authenticates by OIDC.
- **Plan and apply roles are separate.** Plan is assumable from any pull request and carries
  `ReadOnlyAccess`; apply is assumable only from a protected Environment.
- **The apply role cannot manage IAM** (`PowerUserAccess`). Role and policy changes stay a
  deliberate, human act rather than something CI can do to itself. It *can* read IAM, via a
  small inline policy, because the roles live in the same state as everything else and
  `terraform apply` refreshes before it plans — without that, every apply fails reading
  resources it was never going to change. The read grants nothing new: the plan role
  carries `ReadOnlyAccess`, and both roles are assumable from this one repository.

  The consequence to know about: **any change that creates or alters IAM cannot be applied by
  CI.** It will plan clean and fail at apply. Apply it yourself first, then merge, and CI
  finds nothing to do. That is the floor working, not a bug.

  This is not only `modules/github-oidc`. `modules/api` creates a Lambda execution role and
  its policies, so the first apply of that module is a local one too, and so is any later
  change to what the handlers are allowed to touch. Widening a handler's DynamoDB permissions
  being a deliberate, human act is the intended shape of this, not an accident of it.
- **Lock files are committed** (`.terraform.lock.hcl`); state and plans are not.
- **`allowed_account_ids`** is set in every environment, so a wrong-credentials apply fails
  rather than succeeding somewhere unintended.

## Things that will catch you out

- **The table's key schema is a one-way door.** `PK`/`SK` cannot change on a live table;
  changing them means a new table and a full migration. Get §4.2 right before the first
  production write.
- **`prevent_destroy` cannot be conditional.** Terraform forbids variables in `lifecycle`
  blocks, so the rule in `modules/data/main.tf` applies to dev too. Genuinely destroying a
  dev table means commenting it out in a commit. That friction is intentional.
- **One TTL attribute per table.** Every expiry in the system — invite tokens,
  notifications, change-log entries, tombstones, soft-deleted calendars — writes to
  `expiresAt` with different values.
- **GSI projections are effectively immutable.** Changing `non_key_attributes` replaces the
  index, which on a large table is slow and costs a full backfill. Add attributes to the
  projection deliberately: every GSI write is billed as an extra write.
- **Terraform must not own Lambda code.** When functions arrive, create them here with
  `ignore_changes` on the code hash and ship bundles from CI. Infrastructure changes weekly,
  application code hourly, and they should not share a state lock.
