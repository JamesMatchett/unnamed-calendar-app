# Cal&der — Proposed AWS Architecture

Status: proposal / v0.2 · Last updated: 2026-09-02

v0.2 folds in the app-design session: IA and key flows (§3.5), the invite and
membership model (§7, §8), event lifecycle and approvals (§8), and the client sync
experience (§5.6). Decisions taken in that session are listed in §14.

Scope: a serverless AWS backend for the app described in [Brief.md](Brief.md), using the
vocabulary in [Taxonomy.md](Taxonomy.md). Optimised for **low idle cost**, **low latency on
mobile**, and **scaling to many users without re-platforming**.

---

## 1. Headline recommendations

| Question | Recommendation | Why |
|---|---|---|
| API layer | **API Gateway HTTP API + Lambda (arm64)** | ~1/3 the price of REST API, built-in JWT authoriser, zero idle cost. Your instinct was right. |
| Storage | **Single DynamoDB table, on-demand capacity** | Every access path in the Brief is "fetch this calendar's stuff" or "fetch this user's stuff" — key-value, not relational. Small items, huge counts, no idle cost. |
| Auth | **Cognito user pool**, Apple + Google federation only for v1 | Meets the SSO requirement; issues JWTs the HTTP API validates natively (no authoriser Lambda in the hot path). No passwords in v1 — see §3.2. |
| Festival browsing | **Static, versioned JSON bundles on S3 behind CloudFront** | A festival lineup is read-by-thousands, written-by-one. Serving it as a cached file costs ~nothing, is fast anywhere, and doubles as the offline copy. |
| Realtime / push | **DynamoDB Streams → Lambda → SNS/Pinpoint push**, AWS IoT Core MQTT for live in-app updates | Cheaper per connected client than API Gateway WebSockets, and push is what actually matters on mobile. |
| Native calendar sync | **Do it on the device** (EventKit / Android CalendarProvider), plus **read-only ICS feeds** from CloudFront | Avoids storing Google/Microsoft OAuth refresh tokens server-side — a large security and compliance saving. |
| Clients | **Expo / React Native** for mobile, **separate Next.js** for web, shared `packages/core` | The sync engine is the expensive code and is 100% shareable; the UI is not (§3.1). |
| IaC | **Terraform** (decision, Sept 2026) | Mature state management and a portable skill set. The type-sharing argument for CDK is weak here — see §3.6. |

The single most important architectural decision below is **§4: the data model**, because
DynamoDB rewards you for designing access patterns up front and punishes you for not.

---

## 2. System diagram

```
                    ┌──────────────────────────────┐
   iOS / Android    │  React Native (Expo)          │   Web
   ───────────────► │  + SQLite local mirror        │ ◄────── Next.js on
                    │  + native calendar bridge     │         S3 + CloudFront
                    └───────────┬──────────────────┘
                                │ HTTPS (JWT)
                    ┌───────────▼──────────────────┐
                    │  CloudFront                   │
                    │   /api/*   → API Gateway      │
                    │   /fest/*  → S3 (cached)      │
                    │   /media/* → S3 (cached)      │
                    │   /ics/*   → Lambda@Edge/FURL │
                    └───────────┬──────────────────┘
                                │
              ┌─────────────────▼─────────────────┐
              │  API Gateway HTTP API             │
              │  JWT authoriser (Cognito)         │
              └─────────────────┬─────────────────┘
                                │
        ┌───────────────────────▼────────────────────────┐
        │  Lambda (arm64, Node 22, ESM, esbuild bundles) │
        │  calendars · events · rsvp · suggestions ·      │
        │  members · invites · sync · availability       │
        └───────────────────────┬────────────────────────┘
                                │
                    ┌───────────▼───────────┐
                    │  DynamoDB (single      │
                    │  table, on-demand)     │──── Streams ──┐
                    │  + PITR + TTL          │                │
                    └────────────────────────┘                │
                                                              ▼
                                              ┌───────────────────────────┐
                                              │ Lambda: fan-out           │
                                              │  → SNS/Pinpoint (push)    │
                                              │  → IoT Core (live update) │
                                              │  → change-log write       │
                                              └───────────────────────────┘

   Festival ingestion (fully asynchronous, off the user path)
   ─────────────────────────────────────────────────────────
   EventBridge Scheduler ──► Step Functions ──► Lambda fetchers
        (daily / hourly)          │              (Ticketmaster, Skiddle,
                                  │               Songkick, promoter feeds)
                                  ▼
                          S3 "raw" bucket  ──► Lambda normalise + dedupe
                                                     │
                                       ┌─────────────┴──────────────┐
                                       ▼                            ▼
                              DynamoDB (FEST# items)      S3 "bundles" bucket
                                                          fest/{id}/v{n}.json
                                                                │
                                                          CloudFront (public)
```

---

## 3. Component detail

### 3.1 Clients

- **Mobile: React Native + Expo.** One codebase for iOS and Android, and Expo's
  managed native modules cover the two hard bits — calendar access (`expo-calendar`),
  and camera for QR scanning (`expo-camera`).
- **Web: Next.js**, statically exported to S3 + CloudFront. Not server-rendered — there is
  no SEO-critical logged-in content, and static hosting costs pennies. Public festival
  pages are the exception; if you want those indexed, render them at build time from the
  same festival bundles.
- **Local mirror: SQLite on device** (`expo-sqlite`, or WatermelonDB if you want the sync
  engine written for you). This is what satisfies the "view offline when connection is
  spotty" requirement. The app reads from SQLite **always** — never directly from the
  network — and a background sync task reconciles. This makes the app feel instant even
  on good connections, which matters more than most people expect.

**Share the logic, not the UI.** A monorepo with three packages:

```
packages/core     pure TypeScript, no UI: API client, sync engine, mutation queue,
                  conflict rules, RRULE expansion, timezone handling, validation
apps/mobile       Expo / React Native  →  iOS + Android
apps/web          Next.js + React DOM  →  website
```

`packages/core` is where the expensive, correctness-critical code lives — everything in §5.
That is the code you cannot afford to write twice, and it is 100% shareable because it
touches no view layer. The UI layer is the part you *should* write twice, because a phone
and a desktop browser want genuinely different calendar interfaces (a month grid with hover
states and keyboard navigation is not a swipeable agenda list).

React Native Web can technically render the mobile UI in a browser, and Expo Router will
build it for you. It is a reasonable shortcut where the website is only a thin companion —
open a link, glance at a calendar.

**It is still not the right call here.** The strongest argument is the festival catalogue:
if automatic availability of large promoted events is the growth lever, those events must be
*findable*, which means server-rendered, indexable pages carrying structured data. RNW output
is semantically thin and awkward to make accessible — the opposite of what a page competing
for "Glastonbury 2027 lineup" needs.

That catalogue is now deferred past v1 (§6.4), which weakens the argument *for v1
specifically* — but not the decision. Choosing RNW now means rewriting the web app when the
catalogue arrives, and the shared-`core` split above already removes most of the duplication
the shortcut was meant to avoid. Decide once, not twice.

The native capabilities this app actually needs are all first-party Expo modules —
`expo-calendar` (EventKit / CalendarProvider), `expo-camera` (QR), `expo-sqlite`,
`expo-notifications`, `expo-background-task` — which is the specific reason to choose Expo
over bare React Native here. Caveat: `expo-calendar` is likely to be thinner than raw
EventKit around recurrence exceptions, so the two-way sync in build step 10 may need a custom
native module. Budget for that rather than discovering it.

Use **EAS Build and EAS Update**. Over-the-air updates matter disproportionately for an app
whose sync protocol you will iterate on after launch.

### 3.2 Auth

One Cognito **user pool** and **no identity pool** — identity pools exist to vend AWS
credentials to clients, and nothing here needs them: clients talk to API Gateway with a JWT,
and S3 uploads use presigned URLs minted by Lambda. No hosted-UI sign-up screens either,
though federation still needs a user pool **domain** for the OAuth redirect, so configure a
custom one (`auth.calder.app`) — users see that hostname in the browser sheet, and the default
`*.amazoncognito.com` visibly costs conversion. **Apple and Google only for v1** — no email/password (§8.6), which means no
reset flow and no password support burden. Email/password and Microsoft are v2 candidates.
The trade being accepted: losing access to your Google account means losing your calendars,
with no recovery path.

Two things to get right at the very start, both effectively unfixable later:

- **Capture the display name on first authorisation.** Apple returns the user's name *only*
  on the very first authorisation and never again — with Hide My Email it is the only chance
  you get. Miss it and that person is `user_a8f3` permanently, recoverable only by having
  them delete and re-register. It is among the most commonly hit bugs in this space.
- **Apple's Hide My Email** issues a per-app relay address, which is why email-addressed
  invites cannot reliably match Apple users and why §7.2 exists.

- API Gateway HTTP API validates the Cognito access token **natively** — no Lambda
  authoriser, so no cold start and no extra invocation on every request.
- Authorisation (is this user a member of this calendar?) happens **inside** each handler
  as a single `GetItem` on `PK=CAL#{id}, SK=MEMBER#{uid}` — ~0.5 RRU, sub-millisecond,
  about £0.10 per million checks. Do **not** try to encode memberships in the token;
  memberships change and stale tokens become a security bug.
- **The user id is a ULID you mint, not Cognito's `sub`** (decision, Sept 2026). Storing
  `sub` as the primary key is the conventional advice and it quietly contradicts keeping auth
  swappable: every `USER#{uid}`, membership and RSVP would be built on Cognito's identifier,
  so rebuilding the pool or moving IdP breaks all of it. Instead mint a ULID at first
  sign-in, keep an `IDENTITY#{sub}` → `userId` mapping item, and inject the ULID as a custom
  claim in the Pre Token Generation trigger. Handlers read it exactly as they would `sub`, so
  there is **no per-request cost** — the mapping is read once per token issuance, not per
  call. It also makes account linking free: two `sub`s pointing at one ULID is just two
  mapping items.
- Never key anything on the email address — people change them, and Apple relays them.

**Configuration that matters**

- **Cognito holds identity only; the profile lives in DynamoDB.** Avoid custom attributes
  entirely — they are capped, cannot be removed once created, and schema changes often force
  pool replacement. A thin pool is what makes the swap-the-IdP escape hatch real.
- **Account linking is the day-one footgun.** Signing in with Google and later with Apple on
  the same address creates *two separate users* by default, which the user experiences as
  "where did my calendars go?". Link in a **Pre Sign-Up** trigger via
  `AdminLinkProviderForUser`, on **verified** emails only. It cannot help when Apple issues a
  relay address — nothing can — but it covers the common case.
- **Three Lambda triggers, no more**: Pre Sign-Up (linking); Post Confirmation (mint the
  ULID, write the `USER#` profile, capture the Apple display name — idempotent); Pre Token
  Generation (inject the ULID claim, and nothing else — memberships never go in the token).
- **Token lifetimes**: access and ID tokens at the default hour. The 30-day refresh token
  default is too short for an offline-first app — someone on a long trip should not routinely
  fall back to §5.6's read-only mode — so extend it substantially and **test refresh-token
  rotation against the offline path specifically**, since rotation plus a disconnected device
  is where this gets subtle.
- **App clients**: one per surface, both public with PKCE, no client secret in a mobile app
  ever, `ALLOW_USER_PASSWORD_AUTH` disabled outright since there are no passwords. Token
  revocation on sign-out enabled. MFA and threat protection are irrelevant or Plus-tier.
- **Deletion protection on**. Losing a user pool is unrecoverable: every `sub` disappears and
  every membership row in DynamoDB is orphaned with no way to reconnect people to their
  calendars. One pool per environment, never shared between dev and prod.

**Cost warning:** at scale Cognito is likely to be your *largest single line item*, not
compute. The Essentials tier is $0.015/MAU after 10,000 free; the Lite tier is
$0.0055/MAU but drops passwordless/passkey features. At 100k MAU that is roughly
$1,350/month on Essentials versus ~$500 on Lite. **Since v1 is SSO-only with no passkeys,
Lite looks sufficient** — but confirm how Apple and Google federation is billed before
relying on that number, since Cognito prices SAML/OIDC federation separately with only 50
free MAUs, and Sign in with Apple is an OIDC provider. Decide which tier you need early, and
keep the auth layer behind an interface so swapping to a self-hosted or third-party IdP
later is a contained change.

### 3.3 API

- **HTTP API (API Gateway v2)**, not REST API: $1.00 per million requests vs $3.50, and
  lower latency.
- **Lambda, arm64 (Graviton)**: ~20% cheaper per GB-second than x86 for identical code.
- **One function per route group**, not per route and not one monolith. Roughly:
  `calendars`, `events`, `rsvp`, `suggestions`, `members-invites`, `sync`, `festivals`.
  Seven functions keeps each bundle small (fast cold starts) without seven hundred
  deployment artifacts.
- Node 22, TypeScript, bundled with esbuild, `@aws-sdk/client-dynamodb` v3 with tree
  shaking. Target < 2 MB bundles → cold start ~200–300 ms. Use
  **Lambda SnapStart** or provisioned concurrency only if measurement says you need it;
  for a social app, you probably will not.
- Use **AWS Lambda Powertools** for structured logging, tracing and idempotency — the
  idempotency utility in particular is worth adopting on day one for the sync endpoints.

### 3.4 Media

Event and festival images: presigned `PUT` to S3 from the client, a Lambda triggered on
upload that produces 3 sizes with `sharp`, everything served through CloudFront. Never
proxy image bytes through Lambda.

### 3.5 App design: information architecture and key flows

The backend exists to make these flows fast. Recorded here because several of the schema
decisions in §4.3 and §8 only make sense against them.

**Navigation — three tabs, profile behind the avatar**

| Tab | Contents |
|---|---|
| **Agenda** | Everything I am doing across every calendar, chronological (access pattern 13) |
| **Calendars** | My shared spaces (pattern 1), split into bounded and continuous |
| **Discover** | The festival catalogue — **hidden until §6 ships**, not shown empty |

Home is **user-selectable and defaults to Agenda** (`homeTab`, §4.3). Agenda is the
daily-utility screen that earns reopens, but it is empty for a new user, so it falls through
to Calendars when there are no upcoming events. Ship as a two-tab shell; the third appears in
an update, because a visible dead tab makes the app feel unfinished exactly when it can least
afford to.

**Inside a calendar: calendar → day → event**

The calendar screen shows name, description, date range, a day selector, the member list and
upcoming events by date. A day shows everything planned. An event shows name, time, location,
who is going, whether tickets are needed and where to get them.

- The day selector is a horizontal pill strip for **bounded** calendars (a trip's ten days
  all fit) and sticky day headers with jump-to-date for **continuous** ones. Same component,
  keyed off `mode`.
- Availability shows as a count on each day pill — it turns `collectAvailability` from a form
  people fill in into something visible, which is what makes them bother.
- **No month grid on mobile.** Low information density on a phone, disproportionate effort,
  and universally regretted. Agenda list on mobile, day columns for a bounded trip, month
  grid only on web where it earns its space.
- Pending suggestions surface as a badge on the affected event, not an approvals inbox — a
  separate queue makes a social app feel like an issue tracker.

**The group overlap grid is deferred with §6.** The day view already carries most of its
value: avatars on each event row *are* the overlap view at day granularity, which is the
granularity a holiday needs. A dedicated stage/time grid only earns its keep when things run
concurrently, which is a festival-shaped problem. What v1 keeps cheaply: a going-count and
overlapping avatars on each row, and a clash indicator when two events you are Going to
overlap in time.

**First run.** The app is worthless with one user in it, so every decision in the first five
minutes is measured against *does this get a second person in?*

1. A joiner arriving from a link sees the **preview before signing in** — `GET
   /invites/{token}/preview`, the one unauthenticated route in the system, returning counts
   and a date range only. Never member names or event titles: an invite link is a bearer
   token and gets forwarded. That page is `noindex`, always — an indexed invite page is a
   private calendar leaking into search results.
2. Creating a calendar is three fields — name, mode with dates, availability toggle.
3. **Then the first event, then the invite** (decision). Event-first means the joiner lands
   on something real, and the preview can honestly say "6 events" rather than "0".
4. Permissions are requested when earned, never at onboarding: notifications right after
   someone joins your calendar or you create your first event; calendar access the first time
   someone taps "add this to my phone".

**Creating an event is a speed problem, not a form problem.** Every field added reduces the
number of events created, and an empty shared calendar is a dead one. Minimum viable event is
**title plus when**. Three levers, in order of impact:

- **Natural-language entry** — "Drinks at The Crown Thursday 8pm" parsed into editable chips.
  Runs on-device with a date parser, so it works offline, which §5.6 requires.
- **Paste a link** — a ticket confirmation or a DICE/Skiddle URL, fetched and parsed into a
  prefilled event. Note this is an **SSRF surface**: fetching user-supplied URLs from a Lambda
  needs egress restrictions and private-IP-range blocking, not a naive fetch.
- **Duplicate detection** — two people will add the same gig, and it is the most common
  annoyance in shared calendars. Similar title plus overlapping time triggers "Sam already
  added something like this". Runs against local SQLite: free, and works offline.
- **Open an `.ics` file** — register the app as a handler for `text/calendar` so it appears
  in the share sheet when someone taps a calendar attachment in Mail or a browser. Choose a
  calendar, land on the same pre-filled form.

**One draft, several sources.** Manual entry, natural language, a pasted link, an opened
`.ics`, and eventually native calendar import all end in the *same* pre-populated event form.
Building that form as one screen with several entry points — rather than a bespoke flow per
source — is what keeps the fifth source cheap. `.ics` in particular is close to free once it
exists: the mapping is direct (`SUMMARY`→title, `DTSTART`/`DTEND`→the time triple,
`LOCATION`, `URL`→ticket link, `RRULE`→recurrence), and it is a manual, one-file version of
the import in §7.4.

Registering the handler is app-config work rather than native code: `CFBundleDocumentTypes`
plus `LSSupportsOpeningDocumentsInPlace` on iOS, an intent filter for `text/calendar` on
Android. Parse defensively — a real `.ics` may carry several `VEVENT`s and a `VTIMEZONE`, and
files in the wild are frequently malformed.

Events default to the **calendar's** timezone, not the phone's (`defaultTz`) — a holiday in
Spain should not silently schedule in UK time.

**Recurrence** is offered in the create dialog, prominently in continuous calendars and
tucked away in bounded ones. Editing a recurring event always prompts for scope — *this
event / this and all following / all events*.

RSVPs on a recurring event have their own scope, handled differently so the one-tap path
survives: **a tap answers that occurrence**, and *apply to all upcoming* appears afterwards
as a secondary chip rather than as a prompt in the way. §5.5 has the mechanics and the schema
consequences.

**RSVP is the highest-frequency action in the app** by an order of magnitude, so it must be
one tap from the Agenda row, never requiring the event to be opened.

- **No response is not "not going".** Absence of the item is the state — nothing to store —
  but display it: "3 going, 2 maybe, 4 haven't replied".
- That distinction enables the organiser's **nudge**, pushing only to non-responders.
  Rate-limit to one per event per day or it becomes a spam vector inside your own app.
- When `ticketsRequired` is set, a second-line prompt captures `hasTicket` — chasing tickets
  is a genuine trip-planning pain and the answer is already stored for free.

**Empty states are load-bearing**, because the app has three of them and all three occur
before the user has any reason to trust it: no calendars, a calendar with no events, and no
upcoming events. Each should be an action rather than a message. Showing the member list
prominently helps disproportionately — a calendar with two faces and no events reads as a
beginning, whereas "No events yet" reads as broken.

### 3.6 Infrastructure as code

**Terraform** (decision, Sept 2026), not CDK.

The main argument previously made for CDK — sharing TypeScript types between infrastructure
and application code — turns out to be weak for this stack specifically. **DynamoDB is
schemaless apart from its key attributes**, so the table declaration names only `PK`, `SK`,
`GSI1PK` and `GSI1SK`. Item shapes never appear in infrastructure at all; they live in
`packages/core` and are shared by the handlers and the client regardless of what provisions
the table. There is almost nothing to duplicate. (The argument would be much stronger against
a relational schema, where the tables really are declared twice.)

**Setup for this project**

- **Remote state in S3 with native S3 locking** (`use_lockfile = true`) — the separate
  DynamoDB lock table is no longer needed on current Terraform versions. One state bucket per
  environment, versioned, with public access blocked.
- **A directory per environment** wrapping a shared module, not Terraform *workspaces*. The
  three environments live in different AWS accounts, and workspaces-as-environments is a
  well-known trap once accounts, not just variable values, differ.
- `deletion_protection_enabled = true` **and** `lifecycle { prevent_destroy = true }` on the
  table. The second is the Terraform equivalent of CDK's retain policy, and the table is the
  one resource in this system whose loss is unrecoverable.
- **OpenTofu** is a drop-in alternative if the BUSL licence matters to you; nothing in this
  design depends on the choice.

**The one real friction point: Lambda code deployment.** Terraform is good at infrastructure
and poor at shipping application code — letting it own Lambda bundles couples every code
deploy to a state apply, which is slow and makes rollbacks awkward. The end state is to split
them: Terraform creates the functions and their configuration with
`lifecycle { ignore_changes = [source_code_hash, s3_key] }`, and CI ships new code with
`aws lambda update-function-code` against a versioned S3 artifact. Infrastructure changes
weekly; application code changes hourly, and they should not share a lock.

**Amended 5 September 2026 (decision 37): Terraform owns the bundle for now.** The reasoning
above rests on a deploy cadence that does not exist yet. Today there is one function, the
infrastructure is what is moving, and the split costs more than it saves: with
`ignore_changes` on the code, `terraform apply` ships an empty function, so nothing can be
proved end to end until a second pipeline also runs — which is exactly what the first slice
needs to do. So `modules/api` zips the esbuild output with `archive_file` and lets
`source_code_hash` drive redeploys. Both Terraform workflows build the bundle before plan and
apply, and both now trigger on `src/packages/api/**` and `src/packages/core/**` as well as on
`src/terraform/**`, because a handler change genuinely is an infrastructure change under this
arrangement.

Two things this costs, both accepted knowingly, and either of which is reason enough to
switch to the split above:

- A change to `packages/core` made for the mobile app triggers a plan and an apply, because
  core is bundled into the same file.
- A rollback is a state apply rather than a call to `update-function-code`.

---

## 4. Storage: why DynamoDB, and how to model it

### 4.1 The decision

Your items are small (an Event is a few hundred bytes; an RSVP is ~100), numerous, and
almost always fetched by a known key — "everything in calendar X", "everything for user
Y". That is the exact shape DynamoDB is built for, and the exact shape a relational
database charges you for by making you keep a server running.

On-demand DynamoDB costs **$0.625 per million writes** and **$0.125 per million reads**
(eventually-consistent reads are half an RRU, so effectively $0.0625/M), plus $0.25/GB-month
of storage — and **$0 when nobody is using the app**. Aurora Serverless v2 has a floor even
at minimum capacity, plus RDS Proxy if you want Lambda to talk to it without exhausting
connections. For a consumer app with spiky, timezone-clustered traffic, that floor is the
whole argument.

The cost of the decision is that **you must know your access patterns before you create the
table**. They are listed in §4.4. If a pattern is missing there, it is much cheaper to add
it now than after launch.

### 4.2 Single-table design

One table, `uca-main`, on-demand, PITR on, Streams on (`NEW_AND_OLD_IMAGES`), one GSI.

| Entity | PK | SK | GSI1PK | GSI1SK |
|---|---|---|---|---|
| User profile | `USER#{uid}` | `PROFILE` | — | — |
| Calendar | `CAL#{cid}` | `META` | — | — |
| Membership | `CAL#{cid}` | `MEMBER#{uid}` | `USER#{uid}` | `CAL#{cid}` |
| Event | `CAL#{cid}` | `EVENT#{eid}` | `CAL#{cid}` | `T#{startUtc}#{eid}` *or* `SERIES#{eid}` |
| RSVP | `CAL#{cid}` | `RSVP#{eid}#{occ}#{uid}` | `USER#{uid}` | `RSVP#{startUtc}#{cid}` |
| Change suggestion | `CAL#{cid}` | `SUGG#{eid}#{sid}` | — | — |
| Availability (arrive/depart) | `CAL#{cid}` | `AVAIL#{uid}` | — | — |
| Change-log entry | `CAL#{cid}` | `CHG#{seq:012d}` | — | — |
| Invite token | `INVITE#{sha256(token)}` | `META` | — | — |
| IdP identity mapping | `IDENTITY#{sub}` | `META` | — | — |
| Notification | `USER#{uid}` | `NOTIF#{ts}#{nid}` | — | — |
| Pending invite (known user) | `USER#{uid}` | `PENDINV#{cid}` | — | — |
| Pending invite (not yet signed up) | `PENDING#{sha256(email)}` | `INV#{cid}` | — | — |
| Join request | `CAL#{cid}` | `JOINREQ#{uid}` | `USER#{uid}` | `JOINREQ#{cid}` |
| Festival | `FEST#{fid}` | `META` | — | — |
| Festival session | `FEST#{fid}` | `SESS#{sid}` | — | — |

Notes on the shape:

- The **Calendar `META` item** carries the mode (`bounded` with start/end dates for a
  holiday or festival, or `continuous` for an open city calendar), the optional
  `collectAvailability` toggle from the Brief, `sourceFestId` where applicable, and the
  ICS feed token. One item, cheap to read, read on every calendar open anyway.
- **No LSIs.** Using an LSI caps an item collection at 10 GB; without them a single
  calendar's partition can grow indefinitely. Not worth the constraint.
- **Leaving drops the GSI1 attributes, keeps the item.** The membership vanishes from the
  "my calendars" query automatically — a sparse GSI, no filtering, no extra cost — while
  remaining in the calendar's partition for name resolution. Rejoining restores them.
- **`GSI1` is doing two jobs**: "which calendars am I in?" (`GSI1PK=USER#{uid}`) and
  "events in calendar X between two dates" (`GSI1PK=CAL#{cid}`, range on `T#...`).
  Project only the attributes you need onto it — `KEYS_ONLY` or a tight `INCLUDE` — because
  **every GSI write is billed as an extra write**, and a fat GSI is the classic way a
  DynamoDB bill doubles quietly.
- **ULIDs, not UUIDs**, for `eid`/`cid`: lexicographically sortable by creation time, and
  the client can generate them offline, which the sync design depends on.
- **Item collection size**: a friend group's calendar is a few thousand small items. Fine.
  A per-partition throughput ceiling exists (~3,000 RCU / 1,000 WCU) but a single shared
  calendar will never approach it — which is precisely why festivals do **not** live behind
  DynamoDB reads (see §6).

### 4.3 Attributes fixed by the v1 UI design

The keys above are the contract; these are the non-key attributes the app design has
settled on. Recorded here because several of them are cheaper to add now than later.

**Event** — `PK=CAL#{cid}, SK=EVENT#{eid}`

```
title, description
startUtc, endUtc, tz (IANA), localWall      # all three — see §5.5
precision: 'datetime' | 'date' | 'tbc'       # "Saturday, beach day, time TBC" is a real event
rrule?                                       # RFC 5545, series master only — §5.5
seriesId?, recurrenceId?                     # set on occurrence overrides only
status: 'active' | 'cancelled'               # §8.2
cancelledAt?, cancelledBy?
location: { name, address, lat, lng, placeId? }   # structured, never a bare string
ticketsRequired: bool
ticketUrl: string?
allowSuggestions: bool                       # default true, set by the event author
createdBy, createdAt                         # the current author — reassignable, §8.4
originalCreatedBy?                           # set only when an event has been claimed
lastUpdatedBy, lastUpdatedAt
version: number                              # drives the ConditionExpression in §5.4
```

**Calendar** — `PK=CAL#{cid}, SK=META`

```
name, description, coverImageUrl?
mode: 'bounded' | 'continuous'
startDate?, endDate?                         # bounded only
defaultTz                                    # events default to the calendar's tz, not the phone's
collectAvailability: bool                    # the Brief's arrival/departure toggle
requireApproval: bool                        # default true — see §7.1
allowMemberInvites: bool                     # may non-owners invite / mint links?
allowMemberEvents: bool                      # default true — off makes it curated
sourceFestId?                                # §6.1
icsToken                                     # §5.6, rotatable
status: 'active' | 'deleted'                  # 30-day restorable soft delete, §8.5
deletedAt?
createdBy, createdAt
```

There is deliberately **no public/discoverable calendar** (decision, Sept 2026). A public
calendar would make attendance effectively public, contradicting the Brief's visibility rule.
If it is ever wanted it needs its own visibility field and its own privacy design — not
another flag bolted onto joining.

**RSVP** — `PK=CAL#{cid}, SK=RSVP#{eid}#{occ}#{uid}`

```
status: going | maybe | not_going
respondedAt
hasTicket: bool?                             # only meaningful when ticketsRequired
```

`{occ}` is the occurrence's original start instant — RFC 5545's `RECURRENCE-ID` — so that
RSVPs are **per occurrence**, not per series (§5.5).

`{occ}` = `-` is the **series default**: an answer that applies to every occurrence from
`effectiveFrom` onward unless a per-occurrence item overrides it. A non-recurring event is
simply the degenerate case — one series, no occurrences to override — so every RSVP in the
system keeps one key shape:

```
status, respondedAt, hasTicket?
effectiveFrom?                               # series default only
```

Resolution is: per-occurrence item if present, else the series default when the occurrence is
at or after its `effectiveFrom`, else no response. Both item types are still keyed by `uid`,
so pattern 5 keeps its property of **never being able to conflict**.

`hasTicket` rides on the RSVP item at zero extra cost — it is already one item per user per
event — and answers "has everyone actually bought their ticket yet?", which is a real
trip-planning pain with no other natural home.

**User profile** — `PK=USER#{uid}, SK=PROFILE`

```
displayName, avatarUrl, tz, locale
homeTab: 'agenda' | 'calendars'              # user-selectable, defaults to 'agenda'
lastReadNotifAt                              # drives the inbox badge, §7.3
```

**Membership** additionally carries `invitedBy` and `viaInviteToken`, so an owner rotating a
leaked link can see exactly who arrived through it, plus the `role` / `status` fields in §4.5.
It also carries a denormalised `displayName`, because departed members must still resolve to
a name on the events they created (§8.4).

`homeTab` lives server-side rather than in device storage so the choice follows the user
across their phone and the web app.

Two notes on `lastUpdatedBy` and `allowSuggestions`:

- `lastUpdatedBy` / `lastUpdatedAt` are **denormalised for display**. The authoritative
  history is the change log (§5.1), which already records `actorId` and `serverTs` per
  change and retains 90 days — enough to power a tap-through "Sam moved this to 21:00 ·
  2 days ago" history view at no additional storage cost.
- Setting `allowSuggestions` to false must do something explicit with any **pending**
  suggestions on that event. Silently orphaning them loses a member's input without telling
  them. Auto-reject and notify.

### 4.4 Access patterns (the contract)

| # | Pattern | Operation |
|---|---|---|
| 1 | Log in, load my calendars | `Query GSI1 PK=USER#{uid}, SK begins_with CAL#` |
| 2 | Am I a member of this calendar? | `GetItem PK=CAL#{cid}, SK=MEMBER#{uid}` |
| 3 | Open a calendar (everything) | `Query PK=CAL#{cid}` — one request returns meta, members, events, RSVPs, suggestions |
| 4 | Events in a date window | `Query GSI1 PK=CAL#{cid}, SK between T#{from} and T#{to}` |
| 5 | Set my RSVP | `PutItem PK=CAL#{cid}, SK=RSVP#{eid}#{occ}#{uid}` (idempotent, no conflict possible) |
| 6 | Who is going to this event? | filtered from pattern 3, or `Query SK begins_with RSVP#{eid}#{occ}#` |
| 7 | Propose a change | `PutItem SK=SUGG#{eid}#{sid}` |
| 8 | Author approves a change | `TransactWriteItems`: update `EVENT#`, mark `SUGG#` accepted |
| 9 | Set my arrival/departure | `PutItem SK=AVAIL#{uid}` |
| 10 | Group availability view | from pattern 3 |
| 11 | Delta sync since seq N | `Query PK=CAL#{cid}, SK > CHG#{N:012d}` |
| 12 | Redeem an invite | `GetItem PK=INVITE#{hash}` then `TransactWriteItems` to add membership + increment use count |
| 13 | My upcoming events across all calendars | `Query GSI1 PK=USER#{uid}, SK begins_with RSVP#` |
| 14 | My inbox | `Query PK=USER#{uid}, SK begins_with NOTIF#` (descending, paginated) |
| 15 | Invites waiting for me at first sign-in | `Query PK=PENDING#{sha256(email)}` then claim into memberships |
| 16 | Join requests awaiting my approval | `Query PK=CAL#{cid}, SK begins_with JOINREQ#` |
| 17 | All recurring series in a calendar | `Query GSI1 PK=CAL#{cid}, SK begins_with SERIES#` |

Pattern 3 is the one to appreciate: **opening a calendar is a single DynamoDB query**.
No joins, no N+1, one round trip, single-digit milliseconds. That is the whole reason to
accept the single-table modelling tax.

### 4.5 Membership and authorisation

Yes — membership lives in DynamoDB, but as **one item per (calendar, user) pair**, not as a
list of user ids inside the calendar record. The distinction matters more than it looks.

**Rejected: a `members` map on the `CAL#{cid}` `META` item**

| Problem | Consequence |
|---|---|
| Every join/leave rewrites the whole item | Write cost is billed on the *full item size*, in 1 KB units — a 6 KB member map costs 6 WRUs per RSVP-unrelated change |
| One item, many writers | Thirty people accepting an invite at once all contend on one key; you need optimistic locking and retry loops |
| 400 KB hard item limit | A firm ceiling on calendar size, hit long before the product would want one |
| No inverse lookup | "Which calendars am I in?" becomes a table scan |
| Nowhere to hang per-member state | Role, mute setting, last-seen position all bloat the same contended item |

**Recommended: discrete membership items**

```
PK = CAL#{cid}
SK = MEMBER#{uid}
GSI1PK = USER#{uid}
GSI1SK = CAL#{cid}

attributes: role: 'owner' | 'member'          # multiple owners allowed, §8.3
            status: 'active' | 'left' | 'removed'
            joinedAt, leftAt?, removedAt?
            wasRemoved: bool                 # persists across rejoin, §8.4
            invitedBy, viaInviteToken
            lastSeenSeq, notifyMuted, displayName
```

Writes are small and independent, so concurrent joins never contend. Per-member state has a
natural home — `lastSeenSeq` in particular is where a server-side sync watermark lives if
you want unread badges to agree across a user's devices. And the GSI answers "my calendars"
(access pattern 1) for free, which the membership-map design cannot do at all.

**Where the check happens**

In the handler, first thing — not in a Lambda authoriser.

> **The check tests `status == 'active'`, not mere existence.** Membership items are
> soft-deleted rather than removed (§8.4), because departed members must still resolve to a
> name on the events they created. Treating presence as permission would leave every former
> member with full access — a one-line change and a nasty bug if it is missed.
 A `REQUEST` authoriser could cache
the decision, but caching authorisation means removing someone takes up to the cache TTL to
take effect, and you pay an extra invocation and a cold-start risk to get there. A strongly
consistent `GetItem` on `PK=CAL#{cid}, SK=MEMBER#{uid}` is 1 RRU — **$0.125 per million
checks** — and sub-millisecond. Take the correctness.

Two refinements worth having:

- **On reads, the check is free.** Access pattern 3 already does `Query PK=CAL#{cid}`,
  which returns the membership items along with everything else. Assert your own `MEMBER#`
  item is in the result set *before* returning anything, and you have spent no extra
  capacity. Return **404, not 403**, when it is absent — a 403 confirms the calendar exists.
- **On writes, make the check atomic.** Wrap the mutation in `TransactWriteItems` with a
  `ConditionCheck` on the membership item. A user removed between your check and your write
  then fails the write rather than sneaking one through. Two write units, no race.

**Never put memberships in the JWT.** It is tempting — the claim is right there and costs
nothing to read — but tokens outlive their claims. Someone removed from a calendar would
retain access until their token expired, and you would have built a permission system you
cannot revoke.

### 4.6 What DynamoDB will not do for you

Ad-hoc analytics ("how many events per city per month?") are genuinely painful. Do not
try. Instead enable **DynamoDB → S3 incremental export** (or Kinesis Data Firehose off the
Stream) into a Glue/Iceberg table and query with **Athena**. Costs a few pounds a month and
keeps analytical load entirely off the operational table.

---

## 5. Sync, offline and conflicts

This is the hardest part of the Brief and deserves more design attention than the AWS
service selection.

### 5.1 The change log

Every mutation lands in DynamoDB. The Stream consumer (ordered per partition key, so
ordered per calendar) assigns a monotonic `seq` and writes a `CHG#{seq}` item containing
`{seq, entityType, entityId, op, serverTs, actorId, payload}`, with a **90-day TTL**.
Letting the Stream assign `seq` — rather than an atomic counter in the write path — gives
you gap-free ordering for free and keeps the user-facing write to one round trip.

### 5.2 The sync endpoint

```
GET /v1/calendars/{cid}/changes?since={seq}&limit=500
  200 → { changes: [...], nextSeq, hasMore }
  410 → { snapshotUrl }   # client's watermark is older than the retained log
```

A 410 means "you have been offline longer than the log retention — here is a presigned S3
snapshot of the whole calendar, start again from it". This bounds the log's growth and
removes a whole class of edge cases.

### 5.3 Writes from a client that may be offline

- The client generates the ULID, so the write is **idempotent by primary key** and can be
  retried forever. Pair with an `Idempotency-Key` header and Powertools' idempotency
  utility for the non-Put operations.
- Queue mutations in SQLite; drain with exponential backoff on reconnect.
- Optimistic local application: the UI updates immediately, and reconciles when the change
  comes back through sync. Store a `pending` flag so the UI can show it.

### 5.4 Conflict resolution

The Brief's own design mostly solves this, which is worth calling out explicitly:

- **RSVPs cannot conflict** — the key includes the user id. Two people RSVPing at once
  write different items.
- **Event edits are mostly funnelled** — non-authors submit *suggestions* the author
  approves rather than editing directly, which removes most of the conflict surface. This
  fell out of a product decision rather than a technical one, and it is worth keeping.
- **But two roles can still write directly**: the event author, and the calendar owner, who
  by design can edit anything (with attribution shown via `lastUpdatedBy`). Note that
  `allowSuggestions: false` does *not* grant other members a direct edit — it means they can
  neither suggest nor edit, per the table in §8.1. So the concurrent-edit path is real,
  not theoretical: every direct write carries a `version` attribute and a
  `ConditionExpression`, and a stale client gets a 409 and re-syncs rather than silently
  clobbering. Cheap to implement, but do not skip it.
- **Deletes**: tombstones, TTL 90 days, matching the change-log retention so a client
  offline for less than 90 days always converges.
- **Never trust client clocks** for ordering. Stamp everything server-side.

### 5.5 Time and recurrence

Store three things for every event time: the **UTC instant**, the **IANA timezone id**, and
the **original local wall time**. All three. "7pm at the venue" and "18:00 UTC" diverge the
moment a DST boundary or a trip abroad is involved, and this is where calendar apps
reliably break.

Store recurrence as an RFC 5545 `RRULE` string and **expand it on the client**, never in
DynamoDB. Expanded instances in the database are unbounded rows and a migration nightmare.
Cap open-ended rules at a two-year horizon so agenda queries terminate.

**Recurrence is in v1** (decision, Sept 2026), offered in the create-event dialog. It earns
its place mostly in continuous calendars — a five-a-side game every Tuesday — so surface the
control there and tuck it away for bounded ones, where a holiday rarely repeats. Three
consequences reach further than the field itself.

**1. RSVPs are per occurrence, not per series.** "I'm going to football this Tuesday but not
next" is the normal case, not the exception. That is why the RSVP sort key carries `{occ}`
(§4.3) — the occurrence's original start instant, RFC 5545's `RECURRENCE-ID`. Non-recurring
events use a literal `-` so every RSVP keeps one shape. This is the single most expensive
thing to retrofit here: adding an occurrence dimension to a key after RSVPs exist in the
field means rewriting them all.

**2. Date-windowed sync breaks unless series are special-cased.** Access pattern 4 finds
events by `T#{startUtc}` on GSI1 — but a series is *one item with one start time*, so a
weekly event that began in March is invisible to a query for next week. The fix is a
different GSI1 sort key for series masters: `SERIES#{eid}` instead of `T#{start}#{eid}`.
Windowed queries then return one-off events, and a single `begins_with SERIES#` query
(pattern 17) returns every series in the calendar, which the client expands locally. Two
cheap queries, no expansion server-side.

**3. Overrides, not exception lists.** When one occurrence moves — "this week we're at the
other pub at 9" — write a separate `EVENT#` item carrying `seriesId` and `recurrenceId`.
Cancelling a single occurrence is an override with `status: cancelled`, reusing §8.2 rather
than inventing an `EXDATE` list. One mechanism, and it already has a lifecycle.

The edit-scope prompt — *this event / this and all following / all events* — is mandatory,
not a nicety. "This and all following" is implemented by **splitting the series**: set
`UNTIL` on the original rule and create a new series from the split point. Attempting it with
per-occurrence overrides does not scale and is where most implementations come unstuck.

**RSVP scope: this occurrence, or all upcoming.** Answering "all upcoming" writes **one
series-default item**, not a fan-out of RSVPs across future occurrences. Fan-out would be
unbounded against a two-year horizon, would queue a hundred writes on an offline device, and
would still miss occurrences beyond the horizon that do not exist yet. One default item costs
one write, works offline, and covers occurrences not yet expanded — and it reuses the
override pattern already established for events rather than inventing a second mechanism.

`effectiveFrom` stops "I'm going to all of these" from retroactively answering for occurrences
that have already happened. One deliberate simplification: changing your series answer does
not preserve your previous answers for occurrences between the old and new `effectiveFrom`
unless they were set explicitly. Past attendance has little value once an event has happened,
and preserving it means a fan-out on every change.

**The scope prompt must not slow down the common case.** §3.5 insists RSVP is one tap from
the agenda row, and prompting for scope on every tap of a recurring event would destroy that.
So: **one tap answers this occurrence**, and "apply to all upcoming" appears afterwards as a
secondary chip. The fast path stays fast; the powerful path is one extra tap for people who
want it. An occurrence answered by a default shows as such — "Going · all upcoming" — so it
is obvious why it is set and how to change just one.

To keep v1 tractable, **change suggestions (§8.1) apply to a single occurrence only.** A
suggestion carrying its own scope prompt is a second edit-scope UX for a much rarer action.

Recurrence also pays off in export: an `RRULE` passes straight through to ICS and to the
native calendar bridges in §5.7, so a weekly event syncs as one event rather than fifty-two.

### 5.6 How sync surfaces in the UI

The architecture only pays off if the client never makes the user wait for it. **Every screen
reads from SQLite, always** — the network is a background detail, and there is no loading
state for data already held.

Four states, surfaced very unevenly on purpose:

| State | Treatment |
|---|---|
| **Synced** | **No indicator at all.** Badging everything with ticks trains people to look for problems |
| **Pending** — written locally, not yet acknowledged | Subtle: reduced opacity or a small clock glyph. Never blocks: a pending event can still be edited, RSVP'd to, cancelled |
| **Stale** — offline, or no sync in a while | One quiet line at the top of the calendar ("Last updated 2 hours ago"), never per-row markers |
| **Permanently failed** | The only state that earns an interruption, and it should be rare: removed from the calendar, event deleted, validation error. Everything else retries |

"You are offline" is never a modal and never blocks. Everything works; changes queue. The one
honest constraint is that you cannot *see* other people's changes, which the stale line
already says.

**The sync banner** carries both the staleness line and a queued-changes count when there is
one — "12 changes waiting to sync". Someone in a field for two days needs *some* way to tell
whether anything is stuck; a per-item UI would be noise, one line is honest.

**The showcase interaction is an RSVP in a basement with no signal.** Tap Going, it works, no
spinner, no error, still there tomorrow. Access pattern 5 means it genuinely cannot fail for
data reasons, so no network state should ever appear on it. That single tap is the proof of
the whole design.

**Conflicts stay almost entirely invisible.** RSVPs cannot conflict, field diffs merge,
outdated suggestions land quietly in the inbox (§8.1). The one visible case is a direct edit
to the *same field* someone else changed while you were offline: one inline prompt on the
event — "Sam changed the time while you were offline" — never a modal. Different fields merge
silently.

**Auth expiry while offline** must not lock someone out of their own cached calendars. If a
refresh token lapses during a two-week trip: **local data stays readable, writes are blocked**
until re-auth, and anything already queued survives and flushes afterwards rather than being
discarded. The re-auth prompt appears when connectivity returns, not as an offline blocker.

The security consequence is that the local mirror is readable without a valid *server*
session, so encrypt it at rest — SQLCipher or the platform equivalent, with the key in the
iOS Keychain / Android Keystore behind device unlock. That keeps "readable without a session"
from becoming "readable by anything on the device".

**First launch** is the one honest loading state, because nothing is local yet. Make it
progressive: calendars list, then ±30 days of events, then backfill in the background. Show
the agenda the moment the first calendar lands.

**Push is an optimisation, never a correctness mechanism.** A notification should trigger a
background sync so the app is current before it opens, but iOS throttles silent data pushes
and Android has Doze. Correctness comes from sync-on-foreground and pull-to-refresh; nothing
in the design may require timely background execution.

**Joining a calendar is the one thing that genuinely cannot work offline.** Membership is a
server write and until it lands there is no data to show. The QR validates offline (§7), so
say so honestly — "Ibiza 2027 — you'll join when you're back online" — rather than pretending
to show contents.

### 5.7 Native calendar sync

Do it **on the device**:

- **Cal&der → native**: write via EventKit (iOS) / CalendarProvider (Android), keeping a local
  map of `{ucaEventId → nativeEventId, lastSyncedHash}`. No server involvement, no OAuth
  tokens to store, no compliance exposure.
- **Subscribe from anywhere**: also publish a read-only **ICS feed** per calendar at
  `/ics/{cid}/{unguessableToken}.ics` — a Lambda function URL behind CloudFront with a
  60-second cache. That covers Outlook web, Google Calendar and desktop clients with almost
  no code. Revoke access by rotating the token.
- **Native → Cal&der**: read the device's calendars, let the user select events, post them.
- **Two-way**: ship this last. Bidirectional calendar sync is a swamp — duplicate
  detection, recurrence exceptions, "deleted or just not synced yet?", and per-provider
  quirks. One-way Cal&der → native plus manual import covers the majority of the value in a
  fraction of the effort.

---

## 6. Festivals: catalogue, ingestion, and the taxonomy fix

### 6.1 Resolving the Brief's TODO

`Brief.md` flags the festival taxonomy as unresolved. Proposed resolution, consistent with
`Taxonomy.md`:

> A **Festival** is a *catalogue* object, not an App Calendar. It is a read-only,
> app-owned collection of sessions. When a group wants to plan around one, the app creates
> an ordinary **App Calendar** with `sourceFestId` set. Picking a set from the lineup
> **copies** that session into the calendar as an ordinary **Event** carrying
> `festSessionId` and `festSessionVersion`.

Copy, do not reference. Three reasons: the catalogue changes underneath you (stage times
move, artists drop out) and users need a stable copy; the copy is what makes offline work;
and it keeps Event atomic exactly as the Taxonomy demands. When a bundle refresh shows a
newer `festSessionVersion`, prompt: *"The promoter moved Artist X to 21:30 — update?"*

Crucially this needs **no new entity type** and no new privacy rule: attendance still lives
under the shared calendar, so it is still only visible to that calendar's members.

### 6.2 Serving the catalogue

Festival data is written by one process and read by potentially every user at once — the
inverse of the rest of the app. So it does not go through Lambda or DynamoDB on the read
path at all:

- The bundle builder writes **immutable, versioned JSON** to S3:
  `fest/{festId}/v{n}.json`, plus a small `fest/index.json`.
- CloudFront serves them with a long TTL. Immutable paths mean **no invalidations** —
  the index changes, the bundles never do.
- The client downloads a bundle once and keeps it in SQLite, so festival browsing works
  offline in a field with no signal. Which is, notably, where people browse festival
  lineups.
- Cost of serving a lineup to 100,000 people: a few pounds of CloudFront egress. Cost of
  doing the same through API Gateway and DynamoDB: a hot partition and a support ticket.

### 6.3 Ingestion pipeline

EventBridge Scheduler (daily, hourly near festival dates) → Step Functions with a `Map`
over sources → per-source fetcher Lambda → immutable raw JSON to S3 (dated, never
overwritten — this is your audit trail and your replay mechanism) → normaliser Lambda →
dedupe/entity-resolution (fuzzy match on name + date + venue, with a stable
`FEST#{fid}` mapping item so ids survive re-ingestion) → DynamoDB → bundle builder → S3.

Candidate sources: **Ticketmaster Discovery API**, **Skiddle** (strong UK festival
coverage), **Songkick**, **Bandsintown**, plus direct promoter submission via a small admin
surface gated on a Cognito `promoter` group.

**Do the licensing work before the engineering work.** Several of these APIs restrict bulk
caching, require attribution or a link back to the ticket seller, or forbid redistribution.
An architecture that caches lineups into S3 bundles is technically ideal and may be
contractually prohibited by a given source. This is a real project risk, not a footnote.

Keep a **human moderation queue** between ingestion and publication. Automatically merged
festival data is wrong often enough to embarrass you.

### 6.4 The public catalogue: discovery, SEO and the growth loop

> **Status: deferred past v1** (decision, Sept 2026). The promoter surface is a secondary
> feature to be designed once the core app works, and the public indexed pages are the same
> bet — see §6.5 for what to keep anyway.


If the uplift comes from promoted events being automatically available, then discovery is
not a marketing concern bolted on later — it is a **first-class architectural requirement**,
and it happens to fit the design in §6.2 almost for free.

**The loop:** someone searches "Boomtown 2027 lineup" → lands on a public, indexed festival
page → sees "plan this with friends" → installs the app or opens it via a deep link → the
lineup is already there, ready to copy into a shared calendar. The catalogue is both the
retention feature *and* the acquisition channel. That is a good position to be in and worth
building deliberately.

**The pipeline barely changes.** The immutable versioned bundles at `fest/{festId}/v{n}.json`
are already the content source; the public site is a second consumer of them.

```
bundle builder ──► S3 fest/{id}/v{n}.json ──┬──► CloudFront ──► app (offline cache)
                            │               └──► on-demand revalidation ──► Next.js ISR
                            └──► sitemap builder ──► S3 sitemap-{n}.xml
```

Use **Next.js with ISR and on-demand revalidation**, triggered by the bundle publisher —
not a full site rebuild, which does not scale past a few hundred festivals. Host via
**AWS Amplify Hosting** (managed, supports Next SSR/ISR, least ops) or **OpenNext on
Lambda + CloudFront** if you want it under your own Terraform. Start with Amplify; the migration path
to OpenNext is real if the bill or the constraints ever justify it.

**What actually earns the ranking**

- **`schema.org` structured data, JSON-LD.** A `MusicFestival` / `Event` with `subEvent`
  entries for each set, plus `performer`, `location`, `startDate` *with timezone offset*, and
  `offers` linking to the ticket seller. This is what makes you eligible for Google's event
  rich results rather than a plain blue link. Your normalised data model already contains
  every field it needs. Google requires the marked-up content to be **visible on the page** —
  do not emit JSON-LD for a lineup you hide behind a login.
- **The artist long tail is the real prize.** "When is *artist* playing at *festival*" is
  enormous query volume and low competition. Cross-linking artist pages against festival
  pages turns a few hundred indexable festivals into tens of thousands of indexable pages.
  This is the single highest-leverage thing on this list, and it needs artist to be a proper
  entity in the catalogue — `ARTIST#{aid}` items and `artist ↔ session` links — so **decide
  it before ingestion normalisation is written**, not after.
- **Stable, canonical URLs**: `/festivals/{country}/{city}/{slug}-{year}` and
  `/artists/{slug}`. Set `rel=canonical` explicitly; aggregators generate near-duplicate
  routes and Google punishes it.
- **Sitemaps** generated from `fest/index.json` on every publish. Use a sitemap index —
  50,000 URLs per file — and include `lastmod` honestly so recrawls follow real changes.
- **Core Web Vitals** come free: static HTML from CloudFront with the interactive
  "add to my calendar" control as a small hydration island.
- **Universal Links / App Links** so a search result opens the app when installed and the
  web page when not. Without this the loop leaks at its most valuable moment.

**Two risks, both real**

1. **Licensing escalates sharply.** Caching lineup data for in-app use is one ask;
   *republishing it as public indexed pages* is a much larger one. Ticketmaster, Skiddle and
   Songkick terms variously require attribution and link-back, restrict redistribution, or
   prohibit building a competing discovery surface outright. **This determines whether the
   growth strategy is legal**, so it moves from a §6.3 footnote to a gating question.

   The mitigation is strategic, not technical: **direct promoter relationships**. A promoter
   who submits their own lineup grants you the rights to publish it, and gains SEO reach in
   exchange. That reframes the promoter admin surface from a v2 nice-to-have into the thing
   that makes the growth loop defensible. It is probably worth building sooner than build
   step 6 implies.

2. **Thin aggregated content is a known Google target.** Pages that only restate scraped
   listings are squarely in scope for scaled-content-abuse policies. You need something
   additive per page — the planning utility itself, aggregate interest signals ("142 groups
   are planning this"), editorial context, practical guidance. Plan the additive layer as
   part of the page, not as a later SEO rescue.

### 6.5 Deferring the promoter surface: what to keep anyway

Deferring the promoter admin surface and the public indexed pages is a reasonable call, and
it **reduces risk rather than deferring it**: without public republication, the licensing
ask drops from "may we redistribute your catalogue as a competing discovery surface?" to
"may we cache this for in-app use?" — a far more likely yes. §6.3's legal review still
applies, but it is a much smaller conversation.

The two features are coupled, though, and should move together. Public SEO pages without
promoter relationships means publishing third-party catalogue data on the open web with no
rights story behind it, which is the version of §6.4 most likely to end in a takedown. So:
defer both, or neither.

What *should not* be deferred is the handful of decisions that are cheap today and
expensive to retrofit. All of these are data-model and pipeline choices with no UI, no
promoter, and no public page attached:

| Keep in v1 | Why it is expensive later |
|---|---|
| **`ARTIST#{aid}` as a first-class entity**, with artist ↔ session links (minimal form in §6.6) | Retrofitting entity resolution across an already-normalised catalogue means reprocessing everything and reconciling ids users have already copied into their calendars |
| **Provenance on every ingested record** — `sourceId`, `sourceUrl`, `ingestedAt` | Without it you cannot answer "where did this come from?" during a licensing review, or purge one source cleanly |
| **Rights flags** — `redistributable`, `attributionRequired`, `licenceRef` | When public pages do arrive, you can filter to what you are permitted to publish instead of re-ingesting the catalogue to find out |
| **Stable canonical slugs** for festivals and artists | URLs minted later should not change; slugs assigned retrospectively rarely survive contact with duplicates |
| **`ownerPromoterId` on `FEST#` items** (nullable, unused) | Makes a future "claim this festival" flow a field update rather than a migration |
| **The immutable raw S3 archive** (already in §6.3) | Lets you re-normalise the whole catalogue when the artist model lands, without re-fetching from sources that may have changed or revoked access |

Everything else genuinely defers at no cost: the admin UI, the Cognito `promoter` group, the
moderation queue, Next.js ISR, JSON-LD, sitemaps and deep links. None of them constrain the
core build.

The practical version: **ingest as though you will publish, publish only in-app.**

### 6.6 Minimal artist entity for v1

Full entity resolution is deferred. The minimum that does not need retrofitting is a
**ULID plus an alias item**, not an auto-incrementing number.

**Why not an autonumber.** DynamoDB has no sequences. Emulating one means an atomic counter
on a single item — a hot key, an extra write on every artist creation, contention under the
parallel ingestion in §6.3, and a value you cannot generate offline or replay
deterministically from the raw S3 archive. It contradicts the ULID choice made everywhere
else in §4.2 for the same reasons.

**Why not a bare name slug as the key either.** A deterministic
`ARTIST#{slugify(name)}` is tempting — no counter, and it deduplicates common variants for
free. But a slug used as the primary key cannot be merged later without rewriting every
reference, including ones users have already copied into their own calendars. That is the
exact retrofit this section exists to avoid.

**The shape that keeps both properties:**

```
PK = ARTIST#{artistId}          SK = META
    artistId (ULID), displayName, canonicalSlug, createdAt, mergedInto?

PK = ARTISTALIAS#{slug}         SK = META
    artistId

Session items carry:  artistIds: [ULID, ...]
```

`slug` is the normalised name: lowercased, diacritics transliterated, punctuation stripped,
whitespace collapsed, a leading "the" removed. About twenty lines of code, and it collapses
*The Chemical Brothers* / *Chemical Brothers* / *chemical brothers* on its own — which is
most of the practical duplication, without any fuzzy matching.

**Ingestion lookup:** normalise → `GetItem PK=ARTISTALIAS#{slug}`. On a hit, use its
`artistId`. On a miss, mint a ULID and `TransactWriteItems` both items, with a condition that
the alias does not exist so concurrent fetchers race safely. One extra read and occasionally
two extra writes per session — negligible, and entirely off the user-facing path.

**What this buys later.** When real entity resolution arrives, merging *Chemical Bros* into
*Chemical Brothers* is repointing an alias and setting `mergedInto` on the loser. References
already copied into user calendars keep resolving through the redirect. No migration, no
broken links, no reprocessing.

---

## 7. Invites, connections and people

The QR encodes a compact **signed** token — `{cid, role, exp, nonce}`, signed with an
asymmetric KMS key (or an HMAC from Parameter Store if you prefer simplicity). The public
key ships in the app, so a scanning device can **validate the token's structure and expiry
entirely offline** and immediately show "Join *Ibiza 2027*?" with no network.

Redemption still needs the server — adding a membership row is a write — so if the scanner
is offline it queues and completes on reconnect. Server-side the token is stored as
`INVITE#{sha256(token)}` with a TTL and a use counter, giving you revocation and
"max 10 uses" for free.

Genuinely offline **data** transfer between devices (sharing a calendar's contents with no
connectivity at all) needs a local transport — BLE, Multipeer Connectivity, Nearby Share.
Treat that as a separate later project; the signed-invite approach delivers most of the
perceived "it just works offline" benefit for a fraction of the cost.

### 7.1 Two ways in

The share link is one mechanism; it is not the only one, and the second matters more than it
first appears.

**A. The share link** — one rotating token per calendar, not one per person. Groups paste
links into group chats and six people tap them; per-person tokens fight that. Attribution
still works, because the token records its creator: that is what produces "Join James's
*Ibiza 2027*" on the preview. Rotating the token revokes every outstanding copy at once, and
`viaInviteToken` on each membership shows who arrived through which one.

**Whether a link exists at all is state, not policy** — an unrevoked `INVITE#` item, or
none. "Invite-only" is simply a calendar with no live link, reached by revoking it, so it
needs no setting of its own. That leaves exactly two switches:

| Setting | Default | Meaning |
|---|---|---|
| `requireApproval` | `true` | **Every** joiner lands in `JOINREQ#` for an owner or admin to approve, no exceptions |
| `allowMemberInvites` | `true` | Whether non-owners may invite people or mint links at all |

The rule, with no exceptions: **when `requireApproval` is on, every new member is approved
by an owner or admin regardless of who invited them** — including people the owner invited
directly. Sending an invite and admitting the person who turns up are separate acts, and an
invite goes to an address or a username while a *person* arrives claiming it. Confirming at
the door catches the mistyped address and the forwarded invite for free.

Because there are no exceptions, authorisation is a single check with no branches, and
`allowMemberInvites: true` is safe to default on — which matters, since friend groups are not
hierarchical and an owner bottleneck on *inviting* is exactly the friction that kills a group
calendar. The owner still gates who actually gets in.

One UI consequence: when an owner sends a direct invite, say so at that moment — "you'll
confirm when they accept" — so the second prompt reads as the design rather than a bug.

**B. The direct invite** — addressed to a person by email or in-app username, and this is the
one that solves the install problem. A pending invite is a *record*, not a link, so it
survives the App Store: install cold, sign in with Google, and the invite is simply waiting.
No token smuggled through the store, no clipboard handoff, no attribution SDK.

For someone who has not signed up yet, key the pending invite by
`PENDING#{sha256(lowercased email)}`, claimed at first sign-in against the **verified** email
in the SSO token. Hashing means you are not accumulating a plaintext list of addresses
belonging to people who never joined.

Known limitation: Apple's Hide My Email issues a per-app relay address, so an
email-addressed invite will not match unless the inviter knows the address that user
actually signed up with. §7.2 is the answer to that.

### 7.2 Connections, derived — the v1 mechanism

> **Superseded for v2 by §7.3.** A real friends graph *is* being built, because free/busy
> sharing (§7.6) needs a relationship that exists independently of any shared calendar.
> Derived connections remain the v1 behaviour and, importantly, become the **suggestion and
> ranking layer** underneath the friends graph rather than being thrown away.

The graph already exists implicitly: **anyone you have shared a calendar with**. That yields
a "people you have planned with" list with no social graph, no requests, and no compliance
exposure — and it costs nothing, because the client already holds every calendar it belongs
to in SQLite, member lists included. It is a local SQL query with no backend at all.

That property is why it survives the reversal. A friends feature whose search box opens
empty is a cold-start problem; one that opens already listing the people you have actually
been places with is not. §7.3 uses it exactly that way.

### 7.3 The friends graph (v2)

**Decision reversed, Sept 2026.** §7.2 argued that derived connections were enough. They are
not, once the product wants to answer *"when are we both free for a coffee?"* — that question
concerns two people who may share no calendar at all, so the relationship has to exist on its
own.

**Shape**

```
PK = USER#{ownerId}   SK = FRIEND#{otherId}
    status: 'pending' | 'accepted'
    since
    grants: 'none' | 'busy' | 'full'      # what OWNER lets OTHER see (§7.4)

PK = USER#{targetId}  SK = FRIENDREQ#{fromId}   # inbox item, People surface (§7.5)
PK = HANDLE#{lowercased}  SK = META             # username uniqueness
```

One item per direction, each holding what its **owner grants**. Reading "what may I see of
them?" is a single `GetItem` in *their* partition — deliberately, because it keeps the
authority for a disclosure with the person disclosing rather than mirrored into the viewer's
data where it could drift.

**Discovery is a single search box** over three inputs, with suggestions ahead of results:

| Input | Notes |
|---|---|
| `@handle` | Usernames, unique and lowercased. Needs a reserved list, a change policy (rate-limited, old handle held for a period so a released handle cannot be used to impersonate), and an "@" that is genuinely the identifier rather than decoration |
| Email or phone | Stored and matched as a hash, never plaintext. Requires a **"who can find me"** setting, since findable-by-phone-number is not something to default on without asking |
| Suggestions | People you already share a calendar with, ranked by shared calendars and by how many events you have both been Going to. Recency matters more than volume — someone you saw last week beats someone you saw twenty times in 2024 |

The ranking signal is the derived-connections query of §7.2, which is why that work is not
wasted.

### 7.4 Personal availability and visibility (v2)

This is the feature the graph exists for, and it introduces something the app does not
currently have: **a personal, cross-calendar view of one person's commitments.**

**It depends on native calendar import, and that dependency is the sequencing constraint.**
Free/busy computed only from Cal&der events would report you free on a Tuesday afternoon you have
spent in meetings, and a "when are we free?" feature that is wrong a third of the time is
worse than none. So import comes first (decision, Sept 2026).

Usefully, **import for free/busy is far cheaper than two-way sync.** It needs read access to
the device's calendars and nothing more — no duplicate detection, no recurrence-exception
reconciliation, none of the swamp described in §5.7. It populates a busy index and stops:

```
PK = USER#{uid}   SK = BUSY#{startUtc}#{id}
    endUtc, source: 'uca' | 'device', opaque: bool
```

Blocks carry **no titles** at the `busy` visibility level — the index stores what it must and
the API returns only intervals. Mutual availability is then an intersection of complements
over a window, computed client-side from blocks the viewer is entitled to.

**Three visibility levels, granted per friend, per direction:**

| Grant | What they see |
|---|---|
| `none` | Nothing. The default for a new friend |
| `busy` | Intervals only — no titles, no locations, no attendees |
| `full` | The personal calendar, with titles and locations |

Asymmetry is the point: what you show someone is unrelated to what they show you, and the UI
must make *what they can see of you* the prominent fact rather than the reverse.

**`full` is the highest-risk permission in the product** and is deferred past the rest
(decision, Sept 2026). Even `busy` leaks patterns of life — when you are home, when you are
away, when you are reliably out. Titles and locations are another order of magnitude, and
partner-level calendar access is a well-documented vector in controlling relationships. If it
ships, three things are not optional: a **permanently visible indicator** of who can see what,
**revocation that takes effect silently and immediately** (no "X can no longer see your
calendar" notification that turns withdrawal into a confrontation), and **no lock-in** — a
grant is never something another person can prevent you retracting. Design for that case from
the start rather than discovering it in a support ticket.

### 7.5 The inbox

Pending invites, suggestions awaiting your approval, approve/reject outcomes and join
notifications currently have nowhere to live. "Everything awaiting my attention across all
calendars" is a genuinely new access pattern — it cannot be computed from per-calendar data,
because a pending invite is to a calendar you are not yet a member of.

It is nearly free. The Stream consumer already fanning out push notifications (§2) writes a
`USER#{uid} / NOTIF#{ts}#{nid}` item in the same invocation, with a TTL. One extra write on
events that were already generating a push, and you get a durable inbox that agrees across a
user's devices. `lastReadNotifAt` on the profile gives you the badge.

### 7.6 One UX wrinkle worth pre-empting

`requireApproval` defaulting to true adds friction at precisely the moment the QR is meant
to delight: someone scans the code while standing next to the owner, and then waits. The fix is
not to change the default — it is to show incoming join requests **live on the invite screen**
while the owner has it open, approvable with one tap. Same policy, no wait, and the owner
keeps control when they are not in the room.

---

## 8. Lifecycles: events, membership and roles

### 8.1 Change suggestions as field diffs

A suggestion stores **what changed**, not a proposed replacement event:

```
PK = CAL#{cid}   SK = SUGG#{eid}#{sid}
    suggestedBy, suggestedAt
    baseVersion                       # the event version this was written against
    changes: [ { field, oldValue, newValue }, ... ]
    status: 'pending' | 'accepted' | 'rejected' | 'outdated'
```

Three things follow, and they are the reason to prefer diffs over whole-event copies:

- The author sees exactly what moved, instead of diffing two versions by eye.
- Changes can be **partially accepted** — take the new time, decline the new venue.
- Two people suggesting *different* fields do not conflict at all. This takes the
  concurrent-edit surface back down after the owner-can-edit-anything decision widened it in
  §5.4.

Stale suggestions handle themselves: if `baseVersion` no longer matches the event, mark the
suggestion `outdated` and show it as such rather than applying it silently. Apply under a
`ConditionExpression` on `version`.

**Who does what**

| Actor | Editing the event | Approving a suggestion |
|---|---|---|
| Event author | Direct | **Yes — the approver** |
| Calendar owner / admin | Direct, no approval needed | No |
| Any other member | Suggestion (unless `allowSuggestions` is false) | No |

Approval authority sits with the **event author alone**. The calendar owner does not approve
other people's suggestions — they simply make the edit themselves, which is the escape hatch
when an author has gone quiet and suggestions are rotting. Attribution via `lastUpdatedBy`
keeps that visible rather than silent.

Suggestions are **visible to all members** but actionable only by the author, so three people
do not independently suggest the same fix.

### 8.2 Cancel, then delete

Events are not deleted outright. The lifecycle is `active → cancelled → deleted`, and
**delete is only available once an event is cancelled** — which makes accidental destruction
of an event several people have organised around effectively impossible.

- **Cancelling** (event author or calendar owner) sets `status: cancelled`. The event stays
  visible, struck through, and disappears from view some time after its end date. RSVPs are
  retained, so un-cancelling restores the picture intact.
- **Deleting** is a second, deliberate act available only on a cancelled event. It writes the
  tombstone described in §5.4, TTL 90 days, so offline clients converge.

**Notifications this creates** (both ride the existing Stream fan-out and `NOTIF#` items of
§7.3, so neither costs anything new):

| Event | Who is told |
|---|---|
| Event cancelled | Everyone holding an RSVP on it, whatever their answer |
| Event deleted by the calendar owner | The event's author |

The second one matters: the calendar owner can remove someone else's event, and the person
who created it should never simply find it gone.

### 8.3 Roles

Two roles, not three: **`owner`** and **`member`**, with **multiple owners permitted**.

Owners may approve joins, remove members, edit, cancel and delete any event, delete the
calendar, and promote or demote other owners. Members do member things. There is no separate
admin tier — multiple owners covers the case it existed to solve, and it retires the
"inactive owner leaves the calendar unadministrable" problem entirely.

One consequence to surface in the UI rather than discover: **any owner can demote any other
owner, including whoever created the calendar.** Ownership is flat, so promoting someone is a
full transfer of control, not a delegation. Warn at the moment of promotion.

### 8.4 Leaving and removal

**What leaves with you, and what stays**

Events you created belong to the group; your attendance belongs to you. So leaving removes
your **RSVPs** and **availability** — you are not going, and you are not there — while the
**events you created remain**. A trip itinerary should not collapse because one person left
the group chat, and your Going/Maybe persisting in a calendar you have left would be a
privacy problem in its own right.

Events by a departed member carry a banner — *"The person who added this has since left the
calendar"* — and give owners two options: remove it, or **claim it**.

Removal follows the ordinary §8.2 path (cancel, then delete); it is not a special-case hard
delete. The banner itself needs no new schema, since membership status is already synced to
every client and the banner is a local join.

**Claiming matters more than it first appears.** Under §8.1 the *event author* is the only
person who can approve suggestions, so an orphaned event is not merely unattributed — it is
frozen: no member can propose a change that anyone is empowered to accept. Claiming
reassigns `createdBy` to the claiming owner and makes the event editable by the group again.

- **Only owners may claim**, and only while the current author's membership is not `active` —
  condition the write on both.
- **The original author is preserved** in `originalCreatedBy`, so the event reads "Added by
  Sarah · now managed by James". Rewriting history silently would sit badly beside the
  `lastUpdatedBy` transparency established in §4.3.
- The claim is an ordinary versioned write and lands in the change log, so it appears in the
  event's history. It generates **no notification** — this is housekeeping, not news.
- If the original author later rejoins, the event stays with whoever claimed it. Automatic
  reversion would surprise both of them.

**Membership is soft-deleted**, `status: 'left' | 'removed'`, for the name-resolution reason
in §4.5. The GSI1 attributes are dropped so the calendar disappears from that user's list.

**Removal does not permanently bar someone.** A removed user holding a valid link may rejoin
(decision, Sept 2026) — the deliberate trade being simplicity over enforcement, with owners
kept informed rather than the system keeping a ban list.

Two safeguards make that trade safe rather than merely simple:

- Owners are notified when anyone joins via an invite link, so a rejoin is visible
  immediately and the response — remove again, or rotate the link — is one tap.
- `wasRemoved` persists across a rejoin, and **forces the join through approval regardless of
  the calendar's `requireApproval` setting**. With approval on by default this changes
  nothing; with `requireApproval: false` it is the difference between an owner reacting after
  the fact and deciding at the door. Their previous removal is shown in the approval prompt.

`left` and `removed` therefore remain distinct states — not because removal blocks anything,
but because the two carry different meaning in that prompt and in the audit trail.

**Owner departure.** An owner may leave freely while other owners remain. Only when leaving
would take the calendar to **zero owners** are they required to nominate a successor first.
An owner leaving a calendar where they are the last member deletes it, with the confirmation
that implies.

### 8.5 Deletion

**Calendars** get a **30-day restorable soft delete** — `status: 'deleted'` plus a TTL. The
data stays queryable for restore and then expires on its own. "The owner deleted our holiday"
is otherwise unrecoverable, and the mechanism costs nothing.

**Account deletion** (the GDPR path in §9) resolves as pseudonymisation rather than
destruction:

| Data | Fate |
|---|---|
| Profile, notifications, pending invites | Deleted |
| RSVPs, availability | Deleted |
| Memberships | `status: 'removed'`, `displayName` → "Deleted user", avatar dropped |
| Events they created | **Retained**, attributed to an id that no longer resolves to a person |
| Change-log `actorId` | Actively anonymised — do not rely on the 90-day TTL to satisfy an erasure request |

Retaining events is the important product decision, and it belongs in the privacy policy in
plain words: the alternative reading — one person deleting their account destroys a group's
trip — is considerably worse for everyone else in that calendar.

**New notification types** from this section, all riding the existing fan-out: someone joined
via an invite link (to owners), you were removed from a calendar, you were made an owner,
your ownership was revoked, a calendar you were in was deleted.

### 8.6 Explicit non-goals

Recorded so they read as decisions rather than oversights:

- **No comments or discussion threads on events** (decision, Sept 2026). Groups will argue
  about the venue in WhatsApp, and competing with the group chat is not a fight worth
  picking. Revisitable later; deliberately absent now.
- **No plus-ones / `guestCount` on RSVPs** — real for gigs and parties, deferred to v2
  because it complicates every "who's going" surface.
- **No email/password authentication** — Apple and Google only for v1 (§3.2), with
  email/password considered for v2.

---

## 9. Security and privacy

- **Attendance visibility is enforced structurally**: RSVPs live under `CAL#{cid}`, and
  every read path begins with the membership check (pattern 2). There is no query that
  returns one user's RSVPs to anyone but that user (pattern 13 is scoped to `USER#{uid}`).
- Least-privilege IAM per function; use `dynamodb:LeadingKeys` conditions where the key
  prefix is known.
- Customer-managed KMS key for the table; PITR on; AWS Backup with a retention policy.
- WAF on CloudFront (rate-based rules, bot control on the invite endpoints); per-route
  throttling on API Gateway.
- **GDPR deletion**: a Stream-driven job, resolving as pseudonymisation rather than
  destruction — the exact disposition of each data class is in **§8.5**, which supersedes
  any earlier summary. Document the change-log tombstone retention (90 days) and the
  retention of events authored by deleted users in the privacy policy; both are
  lawful-basis questions, not just technical ones.
- Secrets in **Parameter Store** (materially cheaper than Secrets Manager at this volume).
- Note that not storing Google/Microsoft OAuth refresh tokens (§5.6) removes your single
  largest potential breach liability. That is the strongest argument for device-side sync.

---

## 10. Indicative cost

Prices are us-east-1, checked September 2026 — verify before quoting, and note eu-west-2
(London) runs a little higher.

**At ~1,000 monthly active users**

Effectively free. Cognito's 10,000 MAU free tier covers it, DynamoDB and Lambda round to
pennies, CloudFront's perpetual free tier covers the traffic. Realistically **$5–20/month**,
most of it Route 53, CloudWatch Logs and a NAT-free VPC you should not create.

**At ~100,000 monthly active users**

| Service | Assumption | Est. / month |
|---|---|---|
| DynamoDB | 6M writes (+GSI), 60M eventually-consistent reads, ~80 GB | ~$30 |
| API Gateway HTTP API | 30M requests | ~$30 |
| Lambda (arm64) | 30M invocations, 512 MB, ~80 ms | ~$22 |
| CloudFront + S3 | ~500 GB egress, festival bundles + media | ~$15 |
| SNS/Pinpoint push, IoT Core | notifications and live updates | ~$10 |
| CloudWatch, X-Ray, backups | 14-day log retention | ~$30 |
| **Subtotal (compute + storage)** | | **~$140** |
| Cognito — **Lite** tier | 90,000 billable MAU | ~$495 |
| Cognito — **Essentials** tier | 90,000 billable MAU | ~$1,350 |

The point of the table: **your backend costs about $140/month at 100k users, and your
identity provider costs three to ten times that.** Compute is not where the money goes.
Choose the Cognito tier deliberately, and keep auth behind an interface so you can move.

---

## 11. Alternatives considered

| Option | Verdict |
|---|---|
| **Aurora Serverless v2 (Postgres)** | Genuinely tempting — relational modelling is easier to evolve, and ad-hoc queries are free. But there is a capacity floor even at minimum ACU, scale-to-zero resume latency is user-visible, and Lambda needs RDS Proxy. Choose this if you expect complex relational reporting to be core. You do not. |
| **AppSync (GraphQL) + DynamoDB** | Strong fit: subscriptions solve realtime without IoT Core, and the mobile client gets a good caching story. Costs more per operation and adds a resolver layer to learn. **Worth revisiting** if live collaborative editing becomes central. |
| **API Gateway REST API** | 3.5× the price of HTTP API for features (API keys, request validation, WAF-per-stage) you do not need yet. |
| **ECS Fargate + containers** | Cheaper per request at very high *sustained* volume, but carries idle cost and ops burden. Revisit if you ever exceed ~200M requests/month. |
| **DocumentDB / MongoDB Atlas** | Minimum cluster cost with no offsetting benefit here. |
| **Firebase / Firestore** | The honest non-AWS answer. Its offline persistence and realtime listeners would save you *months* on §5, which is the hardest part of this build. Counterarguments: read-heavy cost at scale, weaker analytical story, and a platform you cannot decompose later. Worth a deliberate hour of evaluation rather than a reflexive dismissal. |
| **OpenSearch for festival search** | Serverless OpenSearch has a high monthly floor. Client-side search over downloaded bundles is faster, free, and works offline. Revisit only if the catalogue outgrows what a phone can hold. |

---

## 12. Build order

1. **Foundations** — Terraform repo and remote state (§3.6), three accounts, GitHub Actions
   with OIDC, Cognito pool, one table, one Lambda, one route end to end.
2. **Core loop** — calendars, membership, roles, events, RSVP, and the event lifecycle of
   §8 (suggestions as diffs, cancel-then-delete, claiming). Online only. Prove the
   single-table model against the access-pattern list in §4.4 before it is expensive to
   change.
3. **Offline + sync** — SQLite mirror, change log, delta endpoint, mutation queue. Budget
   more time than feels reasonable; this is the part that determines whether the app feels
   good.
4. **Invites and membership lifecycle** — signed QR tokens, direct invites and pending
   records (§7.1), approval queue, leaving, removal, ownership transfer (§8.4).
5. **Native calendar export** — one-way Cal&der → native, plus ICS feeds.
6. **Festivals** — one source end to end (Skiddle or Ticketmaster), bundles, the
   copy-into-calendar flow from §6.1. Legal review *before* this step, per §6.4.
7. **Push notifications and the inbox** — Stream fan-out to SNS/Pinpoint, writing
   `NOTIF#` items in the same pass (§7.5). Derived connections list (§7.2) comes free with it.
8. **Availability toggle** — arrival/departure per §4.2, trivially additive by then.
9. Later, together: **promoter self-service** and the **public catalogue + SEO** (§6.4).
   Deferred by decision; they ship as a pair, since the promoter relationships are what make
   public republication defensible. Build step 6 still carries the §6.5 obligations.
10. Later: two-way native sync, live in-app updates.

---

## 13. Open questions

1. **Cognito tier** — Lite looks sufficient now that v1 is SSO-only with no passkeys, but
   **confirm how Apple/Google federation is billed** before relying on it: OIDC federation
   is priced separately with only 50 free MAUs, and the difference is roughly $850/month at
   100k MAU.
2. ~~Region~~ **Resolved:** **eu-west-2 (London)** — UK latency and data residency. Note
   prices in §10 are us-east-1 and London runs a little higher; re-cost before quoting.
3. **Festival licensing** — which sources permit caching and redistribution? Blocks §6.
4. **Change-log retention** — 90 days assumed. How long can a user plausibly be offline
   before a full re-sync is acceptable?
5. **Group size ceiling** — is a shared calendar 10 people or 500? Above ~500 members the
   "one query returns everything" pattern (3) needs pagination.
6. ~~Do promoters get write access at launch?~~ **Resolved:** no — deferred past v1, with
   the public catalogue (§6.5).
7. ~~Is `artist` a first-class entity?~~ **Resolved:** yes — minimal form in §6.6 (ULID plus
   alias item), with entity resolution deferred.
8. ~~Recurring events — are they in v1?~~ **Resolved:** yes, in the create dialog, with
   per-occurrence RSVPs and series-aware sync (§5.5).
9. ~~Web app scope for v1~~ **Resolved:** the v1 site is a **thin acquisition surface** —
   the invite preview of §3.5, a landing page, and store links. It opens the app directly
   when installed (universal link, invite pre-populated); after a fresh install the user
   returns and taps the link again, per decision 3 in §14. It is deliberately not a planning
   surface — that arrives with the catalogue (§6.4).
10. **The app still needs a name.** "Unnamed Calendar App" / `Cal&der` stands for now, by
    decision — not an oversight.

---

## 14. Decisions log

Taken during the design session of 2 September 2026, and added to as building changes what
the design was assuming. Recorded so that later readers can tell a decision from an
assumption, and an amendment from a mistake.

| # | Decision | Section |
|---|---|---|
| 1 | Single DynamoDB table, on-demand; HTTP API + Lambda arm64 | §4.1, §3.3 |
| 2 | Membership as discrete items, never a map on the calendar record | §4.5 |
| 3 | Expo/RN for mobile, separate Next.js for web, shared `packages/core` | §3.1 |
| 4 | Festival is a catalogue object; picking a set **copies** it into a calendar | §6.1 |
| 5 | Promoter surface and public SEO catalogue deferred past v1, shipping as a pair | §6.4, §6.5 |
| 6 | Artist entity kept in v1 as ULID + alias item; entity resolution deferred | §6.6 |
| 7 | One rotating share link per calendar, plus addressed pending invites | §7.1 |
| 8 | ~~Connections derived; no friends graph~~ **Reversed** — see 29 | §7.2, §7.3 |
| 9 | `requireApproval` default true, **no exceptions** — even the owner's own invitees | §7.1 |
| 10 | No public or discoverable calendars | §4.3 |
| 11 | Suggestions stored as per-field diffs; the **event author alone** approves | §8.1 |
| 12 | Cancel before delete; owners included | §8.2 |
| 13 | Two roles only — owner and member — with multiple owners permitted | §8.3 |
| 14 | Leaving keeps your events, removes your RSVPs and availability | §8.4 |
| 15 | Removal is not a ban; `wasRemoved` forces approval on rejoin instead | §8.4 |
| 16 | Orphaned events are claimable by an owner, preserving `originalCreatedBy` | §8.4 |
| 17 | 30-day restorable soft delete on calendars; account deletion pseudonymises | §8.5 |
| 18 | Home tab user-selectable, defaults to Agenda; event-first then invite | §3.5 |
| 19 | Read-only local access when auth expires offline; encrypted local mirror | §5.6 |
| 20 | ±30 days on first sync; sync banner carries staleness and queued count | §5.6 |
| 21 | Apple + Google SSO only for v1; no email/password | §3.2 |
| 22 | No comments, no plus-ones | §8.6 |
| 23 | Recurrence in v1; RSVPs per occurrence; overrides not exception lists | §5.5 |
| 24 | "All upcoming" RSVP is one series-default item with `effectiveFrom`, never a fan-out | §5.5 |
| 25 | Region: eu-west-2 (London) | §13 |
| 26 | v1 website is a thin acquisition surface only, not a planning surface | §13 |
| 27 | User id is a self-minted ULID, not Cognito's `sub`; no identity pool | §3.2 |
| 28 | ~~Terraform for infrastructure, with Lambda code deployed separately by CI~~ **Amended** — see 37 | §3.6 |
| 29 | Real friends graph in v2, with @handles; derived connections become its ranking layer | §7.3 |
| 30 | Discovery is one search box: handle, hashed email/phone, and mutual-calendar suggestions | §7.3 |
| 31 | Free/busy sharing needs native calendar **import** first — import only, not two-way sync | §7.4 |
| 32 | Per-friend, per-direction visibility: `none` / `busy` / `full`; `full` deferred past v2 | §7.4 |
| 33 | Two header surfaces: People is a destination, Activity is a feed; badges count only what awaits you | §3.5, §7.5 |
| 34 | Landscape day view on the day screen only; app portrait-locked elsewhere | §3.5 |
| 35 | One pre-filled event draft with several sources: manual, natural language, pasted link, opened `.ics`, native import | §3.5 |
| 36 | `allowMemberEvents` (default true) — contributing and editing someone else's contribution are separate permissions | §4.3, §8.1 |
| 37 | Terraform owns the Lambda bundle until deploys outpace infrastructure changes; amends 28 | §3.6 |
| 38 | A delegated DNS zone per environment in its own account; the apex stays with the site | §3.6 |
| 39 | A dev-only admin-password Cognito client, so the JWT authoriser can be proved to accept as well as reject | §3.2 |

---

## References

- [Amazon Cognito pricing](https://aws.amazon.com/cognito/pricing/)
- [DynamoDB on-demand pricing](https://aws.amazon.com/dynamodb/pricing/on-demand/)
- [Ticketmaster Discovery API](https://developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/)
- [Google Search: Event structured data](https://developers.google.com/search/docs/appearance/structured-data/event)
- [OpenNext — Next.js on AWS](https://opennext.js.org/aws/comparison)
- [Terraform S3 backend — native state locking](https://developer.hashicorp.com/terraform/language/backend/s3)
- [AWS Amplify Hosting](https://aws.amazon.com/amplify/hosting/)
