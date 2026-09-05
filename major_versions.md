# Cal&der — major versions

Last updated: 2026-09-02

Feature milestones per release. Sequencing rationale lives in §12 of
[Architecture.md](Architecture.md); this file is the product-facing view of it.

Each version states what it is **for** — a version that cannot say what it proves is a
feature list, not a milestone.

---

## v1.0 — The core loop

**Purpose:** prove that a group of friends will actually keep a shared calendar current.
Nothing else matters until that is true.

**Ships as a two-tab app** — Agenda and Calendars. Discover is hidden, not shown empty.

| Area | In v1.0 |
|---|---|
| Accounts | Sign in with Apple and Google. No passwords |
| Calendars | Bounded (with dates) and continuous; owner/member roles, multiple owners |
| Membership | Share links, direct invites, pending invites, approval queue, leaving, removal, ownership transfer |
| Events | Create (natural-language entry, paste-a-link, duplicate detection), recurrence, tickets fields, date-only and TBC times |
| Attendance | Going / Maybe / Not going, per occurrence with an "all upcoming" default; ticket tracking; nudge non-responders |
| Changes | Per-field suggestions approved by the event author; owners edit directly; cancel-then-delete; claiming orphaned events |
| Offline | Full local mirror, optimistic writes, mutation queue, sync banner, read-only access when auth lapses |
| Native calendars | One-way export to iOS/Google/Outlook, plus read-only ICS subscription feeds |
| Notifications | Push and in-app inbox |
| Availability | Optional arrival/departure collection on bounded calendars |
| Web | Thin acquisition surface only — landing page, invite preview, store links, deep link into the app |

**Explicitly not in v1.0:** the festival catalogue, promoters, public/indexed pages, two-way
native sync, comments, plus-ones, email/password sign-in, a real web planning surface.

**Exit criteria:** groups create a second calendar without being prompted, and events are
added by more than one member per calendar. Retention of *groups*, not users.

**Main risk:** the invite-to-second-user funnel. If the drop-off through the App Store proves
severe, pending invites and the return-and-tap flow need attention before anything else is
built.

---

## v1.1 — Discover

**Purpose:** turn the app from something you set up into something you open. The catalogue is
the first reason to launch it when nobody has invited you to anything.

- In-app **festival catalogue** — ingestion from one source end to end, normalised, served as
  immutable versioned bundles behind CloudFront and cached offline on device
- **Artist entities** (ULID plus alias items; entity resolution still deferred)
- **Plan-with-friends flow** — a festival seeds a shared calendar; members pick sets from the
  lineup, copied in as ordinary events
- **The group overlap grid** — stage-and-time view of where the group converges and diverges.
  Deferred to here because it is a festival-shaped problem, and it is the screen people
  screenshot into the group chat
- The **Discover tab** appears

**Blocked on:** festival source licensing review. This gates the work, not just the launch.

**Exit criteria:** calendars created *from* festivals rather than from scratch.

---

## v2.0 — Promoters and the open web

**Purpose:** acquisition. Turn the catalogue from a retention feature into a growth channel.

These two ship **together**, deliberately: public republication of third-party lineup data
without promoter relationships is the version most likely to end in a takedown.

- **Promoter self-service** — claim a festival, submit and maintain a lineup, moderation queue
- **Public indexed catalogue** — Next.js with ISR, `schema.org` structured data for event rich
  results, artist and festival pages, sitemaps, canonical URLs
- **Artist entity resolution** — fuzzy matching and merges, unlocking the long-tail
  "when is *artist* playing at *festival*" search surface
- **Universal links** wired end to end so search results open the app
- Additive per-page content, so the pages are not thin aggregation

**Also in v2.0, unrelated to the catalogue:**

- **Native calendar import** — read-only, device-side. Much cheaper than two-way sync (no
  duplicate detection, no recurrence reconciliation) and the prerequisite for everything
  below it
- **Friends** — `@handles`, requests, one search box over handle / hashed email or phone /
  suggestions ranked by shared calendars and mutual attendance
- **Open an `.ics` file** — the app appears as a handler for calendar attachments; pick a
  calendar and land on a pre-filled event form. Cheap once the draft form exists, and shares
  its parsing with native import
- **Free/busy sharing and mutual availability** — "when are we both free for a coffee?",
  granted per friend and per direction, intervals only with no titles
- **Email/password authentication** — removes the "lose your Google account, lose your
  calendars" trade
- **A real web planning surface** — month grid, side-by-side calendars, keyboard navigation.
  Only worth building once there is desktop traffic to justify it

The three availability items are strictly ordered: import, then friends, then free/busy.
Free/busy computed from Cal&der events alone would report you free during a day of meetings, and
a "when are we free?" feature that is wrong a third of the time is worse than not having one.

**Exit criteria:** organic search delivering installs.

---

## v3.0 and beyond — backlog

Not scheduled. Listed so the reasons for deferral are not lost.

| Feature | Why it waits |
|---|---|
| **Live in-app updates** | Push plus sync-on-foreground is sufficient. Revisit with AppSync or IoT Core if collaborative editing becomes central |
| **Comments on events** | Deliberate non-goal for now. Only if it becomes clear groups want the discussion *in* the app rather than in the chat |
| **Plus-ones on RSVPs** | Complicates every "who's going" surface for a real but narrow case |
| **Full personal calendar sharing** | Partner-level access to titles and locations. Deferred past v2 deliberately: even free/busy leaks patterns of life, and full access is a documented vector in controlling relationships. Needs a permanently visible indicator of who can see what, silent immediate revocation, and no lock-in — see §7.4 |
| **Two-way native calendar sync** | Distinct from the read-only import in v2.0. This is the swamp: duplicate detection, recurrence exceptions, per-provider quirks |
| **Public / discoverable calendars** | Needs its own visibility model and privacy design — attendance would become effectively public |
| **Offline device-to-device sharing** | Needs BLE / Multipeer / Nearby. Signed offline-validating invites already deliver most of the perceived benefit |
| **Analytics surface** | DynamoDB is poor at ad-hoc queries; needs the S3 export and Athena path in §4.6 |

---

## Sequencing rules

Three constraints that override any reordering:

1. **The data model decisions in v1.0 are one-way doors.** The base table key schema, the
   occurrence dimension on RSVPs and the artist entity must be right at v1.0 even where the
   feature using them ships later.
2. **Legal review precedes catalogue engineering**, not the other way round.
3. **Promoters and public pages ship as a pair.** Neither alone is defensible.
