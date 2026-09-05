# @calder/core

Shared domain model: types, key builders and the rules that must not be
implemented twice.

Imported by the Lambda handlers, the Expo app and the web app. **No AWS SDK, no
UI, no I/O** — that is what makes it importable from all three, and it is the
part of the monorepo split in Architecture.md §3.1 that carries the weight.

| Module | Contents |
|---|---|
| `ids.ts` | Branded ULID types. A `CalendarId` cannot be passed where an `EventId` is expected |
| `time.ts` | The UTC + timezone + wall-clock triple, recurrence horizon, TTL retention windows |
| `keys.ts` | Every partition and sort key in the table. The only code that should build a key |
| `entities.ts` | Item shapes, discriminated on `entityType` |
| `membership.ts` | Authorisation: who may edit, approve, cancel, delete, claim, invite, leave |
| `rsvp.ts` | Occurrence-vs-series-default resolution, and the attendance tally |
| `sync.ts` | The delta-sync contract, snapshot fallback, and the local mutation queue |

## Why these particular helpers

Three rules are subtle enough that a second implementation would eventually
disagree with the first:

- **`isActiveMember`** — membership items are soft-deleted, so presence is not
  permission. Testing existence leaves every departed member with full access.
- **`resolveRsvp`** — an explicit occurrence answer beats the series default,
  which itself only applies from `effectiveFrom`.
- **`GSI1_KEYS.eventSeries`** — recurring events sort under their own prefix
  because a series is one item with one start time, and would otherwise be
  invisible to any date-window query.

## Commands

```sh
npm install
npm run typecheck
npm run build
```
