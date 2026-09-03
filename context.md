# Cal&der — Project context

Last updated: 2026-09-02

Orientation for anyone (human or model) picking this project up. **What** it is, **why** the
shape is what it is, and **where** everything lives. For the technical design see
[Architecture.md](Architecture.md); for current state and open threads see
[memory.md](memory.md); for the release plan see [major_versions.md](major_versions.md).

---

## What we are building

A cross-platform, **mobile-first shared calendar app** for groups of friends. Two shapes of
calendar:

- **Bounded** — a holiday, a festival weekend, a trip. Has start and end dates.
- **Continuous** — a group of friends in the same city listing what they are each going to,
  in case it is of interest to the others.

Friends submit events to a shared calendar; invited members answer **Going / Maybe / Not
going** and can propose changes the event's author approves. Events sync out to people's
native calendars (iOS, Google, Outlook). Large promoted events — festivals with many artists,
stages and set times — are pulled into the app so a group can build a private shared calendar
around one and see who is going to what.

"Cal&der" is a placeholder name, kept deliberately (§13 of Architecture.md).

## Who it is for

Groups of friends organising social time — the people currently doing this badly across a
WhatsApp thread, six screenshots and someone's Notes app. The unit of value is a **group**,
never an individual: the app is worthless with one user in it, and that single fact drives
more design decisions than any other.

Secondary, later: **promoters** who curate large events and would benefit from their lineups
being importable and discoverable (deferred — see major_versions.md).

## Constraints that shaped the design

| Constraint | Consequence |
|---|---|
| Cheap at rest, scalable under load | Fully serverless, on-demand everything, no idle cost |
| Mobile-first, spotty connectivity | Offline-first client with a local SQLite mirror; the network is never on the critical path |
| Many users, small items | DynamoDB single-table rather than relational |
| UK user base | eu-west-2 (London) |
| Small team | Managed services over operated ones; defer anything that is not the core loop |

## Product principles that emerged

These were arrived at during design rather than declared up front, and they resolve most
"should we…" questions without needing a new decision.

1. **The app is worthless with one user in it.** Every decision in the first five minutes is
   judged by whether it gets a second person in. Creating a calendar ends in sharing, not in
   an empty calendar.
2. **Never make someone wait for data you already have.** Everything reads from local
   storage. Sync is a background detail; there is no spinner for cached data.
3. **Speed of event creation is the product.** Every field added reduces the number of events
   created, and an empty shared calendar is a dead one.
4. **Do not compete with the group chat.** No comments, no discussion threads. Groups will
   argue about the venue in WhatsApp and that is fine.
5. **Attendance is private to the calendar it is in.** There is no global feed and no public
   calendar, because either would make attendance effectively public.
6. **Prefer designs where conflicts cannot happen** over designs that resolve them. RSVPs are
   keyed per user, suggestions are per-field diffs, events are copied rather than referenced.
7. **Attribution over silence.** People can see who changed what. Nothing is rewritten
   invisibly.

## Vocabulary

[Taxonomy.md](Taxonomy.md) defines Event, Calendar, App Calendar, Native Calendar, Festival,
Promoter and User. Terms introduced during design:

| Term | Meaning |
|---|---|
| **Occurrence** | One instance of a recurring event, identified by its original start instant (RFC 5545 `RECURRENCE-ID`) |
| **Series default** | An RSVP that applies to all upcoming occurrences unless a per-occurrence answer overrides it |
| **Pending invite** | An invite addressed to a person rather than embodied in a link; waits for them in-app after sign-up |
| **Derived connections** | "People you have planned with" — computed from shared calendar membership, not a friends graph |
| **Catalogue** | The app-owned, read-only festival data. Distinct from any user's calendar |
| **Claiming** | An owner taking authorship of an event whose creator has left the calendar |

## Documents

| File | Purpose |
|---|---|
| [Brief.md](Brief.md) | The original product brief. Source of truth for intent |
| [Taxonomy.md](Taxonomy.md) | Shared vocabulary |
| [Architecture.md](Architecture.md) | The technical design. §14 holds the decisions log |
| [context.md](context.md) | This file — orientation and principles |
| [memory.md](memory.md) | Current state, conventions, and the traps worth knowing |
| [major_versions.md](major_versions.md) | What ships in which release |

## How decisions are recorded

Decisions are folded into Architecture.md at the point they are made, and each is added to
the **decisions log in §14** with a section pointer and a date. A decision that only exists
in a conversation does not exist. Where a decision supersedes earlier prose, the earlier
prose is corrected rather than left to contradict it.
