# Cal&der — working memory

Last updated: 2026-09-02

Carry-over state for future sessions: where the project actually is, the conventions in use,
and the traps that cost real thought to find. Read [context.md](context.md) first for what the
project *is*.

---

## Where things stand

**Design complete, no code written.** The repository contains documents only.

| Area | State |
|---|---|
| Backend architecture | Settled — Architecture.md v0.2, 28 logged decisions |
| Data model | Settled to the key-schema level; item attributes specified in §4.3 |
| Sync and offline | Settled, including the client UX (§5.6) |
| Invites, membership, roles | Settled (§7, §8) |
| Event lifecycle and approvals | Settled (§8) |
| App IA and key flows | Settled (§3.5) |
| Festivals, promoters, SEO | Designed but **deferred past v1** (§6.4–6.6) |
| Visual design | Not started |
| Infrastructure code | **Written, PENDING** — `src/terraform` skeleton, state bootstrap, the DynamoDB table module, GitHub OIDC roles, plan/apply workflows all exist. **Nothing has been applied**, and it is parked until the AWS accounts exist |

### Parked: Terraform and CI

Blocked on AWS account creation and the surrounding plumbing (Organization, accounts,
billing, admin access). The code is committed but inert. When the accounts are ready,
`src/terraform/README.md` has the full sequence; the short version:

1. `terraform fmt -recursive src/terraform` **first** — the files were authored without a
   local Terraform binary, so formatting is unverified and the CI `fmt -check` job will
   otherwise be the first thing to fail.
2. Run `bootstrap/` in each account; note the three outputs.
3. Replace `REPLACE_WITH_ACCOUNT_ID` in each env's `backend.tf` and `terraform.tfvars`.
4. Apply `envs/dev` locally once to create the CI roles.
5. Set the three repository variables, create the three GitHub Environments, and add
   required reviewers to `prod`.

Nothing else in the project depends on this being done.

### Done since

- **`src/packages/core`** — branded ULID ids, the time triple, every key builder, all item
  shapes, and the authorisation and RSVP-resolution rules. Typechecks clean under `strict` +
  `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`, and `npm test` runs 22 node:test
  assertions covering the rules subtle enough to be reimplemented wrongly. No runtime
  dependency beyond `ulid`.

- **`src/apps/mobile`** — Expo SDK 57 app, npm workspaces at the repo root. The §3.5
  vertical slice (Calendars → Calendar → Day → Event, plus Agenda) on a real SQLite mirror
  with seeded fixtures, one-tap RSVP writing through a mutation queue, light and dark
  themes. Typechecks clean; `expo export` bundles for iOS, Android and web.

- **Inbox and People** — two header affordances on tab roots: left is **People**, a
  destination (derived connections + pending calendar invites); right is **Activity**, a feed
  (events, suggestions, cancellations). The split lives in `@calder/core`
  (`surfaceFor`, `isActionable`) so the surfaces cannot disagree. **Badges count only what is
  waiting on you**, never unread news.
- **Landscape day view** — rotating the phone on a day screen swaps the list for an hour
  grid with side-by-side overlaps, a now-line, and an untimed strip for `date`/`tbc` events.
  Rotation is unlocked *only* on that screen; the app is portrait-locked everywhere else, so
  no other screen has to be designed for landscape. The column-packing algorithm lives in
  `@calder/core` (`layoutDay`) because the web day/week view will need the same one, and that
  is where the tests are.

- **Friends prototype** — search (handle / name / email), "Add friend" on suggestions, and a
  Manage friends screen with incoming, outgoing and accepted. Local only: a `directory` table
  stands in for the discovery API, and only the current user's `friends` rows exist. Shapes
  follow §7.3 so swapping queries for API calls is contained. Per-friend visibility (§7.4) is
  deliberately **absent** — inert until free/busy exists, and a dead toggle would pollute any
  judgement of whether the screen works.

### Unblocked next artefacts

1. First-run flow: create calendar → first event → invite (§3.5).
2. Event creation, with natural-language entry and duplicate detection.
3. Cognito user pool and the three Lambda trigger definitions (§3.2) — writable now,
   appliable later.
4. The first Lambda handler and route, against `@calder/core`.

### Known limitation: expo-sqlite on web

`openDatabaseSync` needs `SharedArrayBuffer` and a sync-access worker, and fails on web with
"Sync operation timeout" even under cross-origin isolation. iOS and Android are unaffected.
Two ways out are written up in `src/apps/mobile/README.md`; the better one — hydrate a
calendar into memory on entry, keep reads synchronous, write through to SQLite — is also the
shape the app will want at scale. Not urgent: v1's website is a thin acquisition surface, not
this app in a browser.

## Still open

1. Confirm how Cognito bills **Apple/Google federation** before relying on the Lite tier —
   OIDC federation is priced separately with only 50 free MAUs (§13.1).
2. **Festival source licensing** — blocks the catalogue work, deferred with it (§13.3).
3. **Change-log retention** — 90 days assumed, never validated (§13.4).
4. **Group size ceiling** — above roughly 500 members, "one query returns the whole calendar"
   needs pagination (§13.5).
5. ~~The name.~~ **Settled: Cal&der.** The ampersand is the brand mark and matches
   `&handle`, but it is illegal in bundle ids, npm package names, URL schemes and domain
   names, and is the query separator in URLs. So the display name is the ONLY place it
   appears. **The domain is calandder.com** (cal-and-der; bought Sept 2026, Route 53 hosted
   zone), and every machine-readable name derives from it: bundle id and Android package
   `com.calandder.app`, URL scheme `calandder://`, links `https://calandder.com/join/<token>`
   and `/get`. `@calder/core` keeps its short name. Never "fix" a machine-readable name to
   match the logo.
6. ~~The app-invite link is a placeholder.~~ Points at `https://calandder.com/get`, served
   from `site/get/index.html` (detects the phone, sends to TestFlight now and the store
   later; `?from=<handle>` carries the inviter). **Still to do: deploy `site/` to the domain
   and fill in the TestFlight link**, plus the Apple Team ID in
   `site/.well-known/apple-app-site-association` for universal links.
7. **Alpha build readiness (Sept 2026).** The seven blockers are done: deletion and leaving,
   local writes drawn as settled (`LOCAL_ONLY` in `src/config.ts`, flip when sync lands),
   first-run identity, example data as a Settings choice, an error boundary plus
   `reportError` seam for Sentry and a Send feedback row (mailto hello@calandder.com),
   icon and splash (`tools/icon.py`), and the domain. Still open before TestFlight: an
   Android emulator run, `expo-updates`, local reminders, a Sentry DSN.

## Conventions

- **No em dashes in user-facing copy** (decision, Sept 2026). Labels, hints, empty states,
  alert bodies and button text use a comma, a colon or a full stop instead. Code comments and
  the design documents are unaffected. A quick check:
  `grep -rn "—" src/apps/mobile/app src/apps/mobile/src --include=*.tsx --include=*.ts | grep -v "^\s*//"`


- **Decisions are folded into Architecture.md immediately** and logged in §14 with a section
  pointer. Cross-references use `§n.n` and are expected to resolve — there is a check for it:
  `python3 -c "import re;s=open('Architecture.md').read();h=set(re.findall(r'^#{2,3} (\d+(?:\.\d+)?)\.? ',s,re.M));r=set(re.findall(r'§(\d+(?:\.\d+)?)',s));print(sorted(r-h))"`
- **Identifiers are ULIDs**, client-generatable and time-sortable. Never auto-increment
  counters (no sequences in DynamoDB, and they are a hot key).
- **British English** throughout the documents.
- Superseded prose is **corrected, not left standing**. Two documents disagreeing is worse
  than either being wrong.

## Traps — things that were not obvious

Ordered roughly by how expensive they are to discover late.

1. **The DynamoDB base table key schema is immutable.** `PK`/`SK` cannot be changed on a live
   table. Changing your mind means a new table and a full migration. Indexes can be added
   later; the foundation cannot.
2. **RSVPs must carry an occurrence component** (`RSVP#{eid}#{occ}#{uid}`). Adding that
   dimension after RSVPs exist in the field means rewriting every one of them (§5.5).
3. **Apple returns the user's display name only on the very first authorisation**, never
   again. Miss it in the Post Confirmation trigger and that person is `user_a8f3` for ever,
   recoverable only by deleting and re-registering (§3.2).
4. **DynamoDB allows exactly one TTL attribute per table**, and this design has five uses for
   expiry — invite tokens, notifications, the change log, delete tombstones, soft-deleted
   calendars. They must all share one attribute name with different values.
5. **The membership check tests `status == 'active'`, not existence.** Membership items are
   soft-deleted so departed members still resolve to a name on events they created. Treating
   presence as permission leaves every former member with full access (§4.5).
6. **Date-windowed sync silently misses recurring events.** A series is one item with one
   start time, so a weekly event that began in March is invisible to a query for next week.
   Hence the `SERIES#{eid}` GSI sort key (§5.5).
7. **Cognito creates two separate users** when someone signs in with Google and later Apple
   on the same address. Users experience it as losing all their calendars. Link in a Pre
   Sign-Up trigger on verified emails only (§3.2).
8. **The invite preview page must be `noindex`.** An indexed invite page is a private calendar
   leaking into search results — and it is a different surface from the public festival pages,
   which *do* want indexing (§3.5, §6.4).
9. **Paste-a-link event creation is an SSRF surface.** Fetching user-supplied URLs from Lambda
   needs egress restrictions and private-IP blocking (§3.5).
10. **Invite tokens do not survive the App Store.** A fresh installer loses the link and must
    return and tap it again. Accepted for v1; pending invites (§7.1) are the real mitigation.
11. **GSI writes are billed as extra writes.** A fat projection is the classic way a DynamoDB
    bill doubles quietly. Project only what is needed (§4.2).
12. **Terraform should not own Lambda code.** Coupling code deploys to state applies is slow
    and makes rollback awkward. `ignore_changes` on the code hash, ship via CI (§3.6).
13. **Cognito is likely the largest single line item** at scale — three to ten times the whole
    compute and storage bill. Keep auth behind an interface (§3.2, §10).

## The friends reversal (Sept 2026)

Decision 8 — derived connections, no friends graph — was **reversed** partway through the
build. A friends graph is now v2, because free/busy sharing concerns two people who may share
no calendar at all, so the relationship has to exist independently. §7.3 and §7.4 carry the
design; decisions 29–32 log it.

Three things worth carrying forward:

- **The derived-connections work survives.** It becomes the suggestion and ranking layer
  under the friends search box, which is what stops a friends feature opening on an empty
  screen.
- **Free/busy depends on native calendar import**, and import is far cheaper than two-way
  sync — read-only device access, no duplicate detection, no recurrence reconciliation. The
  order is import → friends → free/busy, and it is not negotiable: free/busy from Cal&der events
  alone reports you free during a day of meetings.
- **`full` visibility is deferred past v2 on purpose.** Even `busy` leaks patterns of life.
  If it ships it needs a permanently visible indicator, revocation that is silent and
  immediate, and no way for the other person to prevent withdrawal.

## Frontend and tooling traps

Found while building the app, and all of them cost time to diagnose.

1. **Expo Go from the App Store lags the SDK.** As of May 2026 Expo Go on the store still
   targeted SDK 54, with SDK 55 pending Apple review; this app is on **SDK 57**, so a
   physical iPhone running store Expo Go will refuse the project. The *simulator* build of
   Expo Go is fetched by the Expo CLI and is not App Store gated, so `press i` works fine.
   For a physical device you need a development build (`npx expo run:ios`, or EAS Build),
   which needs Xcode locally or an Apple Developer account for device installs.
2. **Metro reads `@calder/core` from SOURCE, not `dist/`** — deliberately, via a
   `resolveRequest` alias in `metro.config.js`. Before that, editing core and reloading gave
   you the *old* core against *new* app code, and the symptom was an undefined export at
   runtime nowhere near the cause. Core keeps `.js` extensions on relative imports (Node's
   ESM loader needs them for Lambda later), so the resolver rewrites them to `.ts`.
   `npm run build:core` is still needed for typechecking and for the eventual Lambda bundles,
   but no longer for running the app.
3. **Metro needs explicit monorepo wiring.** `watchFolders`, `nodeModulesPaths` and
   `disableHierarchicalLookup` in `metro.config.js`. Without them, importing `@calder/core`
   fails with an unhelpful "module not found" that reads like a typo.
4. **`wasm` must be added to Metro's `assetExts`** or the web bundle fails to resolve
   `expo-sqlite`'s WASM build — while iOS and Android build fine. A confusing
   platform-specific break.
5. **Never run `npm install` for this repo from a Linux shell.** Native dependencies resolve
   per-platform; installing from anywhere other than the Mac leaves binaries that fail at
   runtime. (Relevant when a tool has shell access to the repo from a Linux VM.)
6. **`node --test` needs a glob, not a directory** — `node --test "test/*.test.mjs"`.
   Passing `test/` makes it try to execute the directory as a file.
7. **`expo-sqlite`'s synchronous API does not work on web** — see the section above.
8. **Backticks inside a SQL template literal silently end the string.** The schema lives in a
   TypeScript template literal, so a backtick in a SQL *comment* terminates it and the error
   surfaces dozens of lines later as a nonsense syntax error. Never use backticks in
   `schema.ts` comments.
9. **`expo start` must run in `src/apps/mobile`, never the repo root.** The root has no
   `main`, so Expo falls back to its default `AppEntry.js` and fails with
   `Unable to resolve "../../App"` - which reads like a missing file rather than a wrong
   directory. `npm start` at the root now delegates to the workspace, so either place works.
10. **Plain `git status` from a sandboxed shell can strand `.git/index.lock`.** It takes the
   index lock to refresh, and if that shell cannot delete files the lock survives, after
   which every git command fails with "Another git process seems to be running". Use
   `git --no-optional-locks status`, which does not take the lock. To recover, `mv` the lock
   aside — deleting it is not always possible from that shell.

## Things deliberately not built

Recorded so they are not re-proposed as oversights: comments and discussion threads,
plus-ones on RSVPs, email/password authentication, public or discoverable calendars, a friends
graph, a month grid on mobile, and a permanent ban on removed members. Each has a rationale in
Architecture.md; see §8.6 and the decisions log.
