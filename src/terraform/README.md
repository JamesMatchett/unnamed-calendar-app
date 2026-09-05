# Infrastructure

Terraform for Cal&der. Design rationale is in [Architecture.md](../../Architecture.md) §3.6;
this file is the operating manual.

```
src/terraform/
  bootstrap/          run once per account, local state — creates the state bucket
  modules/
    data/             the single DynamoDB table (§4.2) + its CMK
    github-oidc/      OIDC provider and the CI plan/apply roles
  envs/
    dev/ staging/ prod/   one root module per environment, one per AWS account
```

**A directory per environment, not Terraform workspaces.** The environments live in
different AWS accounts, and workspaces-as-environments breaks down once accounts rather than
just variable values differ.

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

After that, CI owns it: pull requests plan all three environments, and merges to `main`
apply dev → staging → prod in order.

## Conventions

- **No long-lived AWS keys.** Everything authenticates by OIDC.
- **Plan and apply roles are separate.** Plan is assumable from any pull request and carries
  `ReadOnlyAccess`; apply is assumable only from a protected Environment.
- **The apply role cannot manage IAM** (`PowerUserAccess`). Role and policy changes stay a
  deliberate, human act rather than something CI can do to itself.
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
