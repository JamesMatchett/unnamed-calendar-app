# @uca/mobile

Expo / React Native app. SDK 57, React 19, new architecture on.

## Running it

From the repo root:

```sh
npm install          # workspaces: installs core and mobile together
npm run build:core   # @uca/core must be built before the app can import it
npm run mobile       # or: npm start --workspace @uca/mobile
```

Then scan the QR with Expo Go, or press `i` / `a` for a simulator.

## What is here

The vertical slice from Architecture.md §3.5: **Calendars → Calendar → Day →
Event**, plus the Agenda tab, running entirely on seeded local data.

```
app/
  (tabs)/index.tsx                          Agenda — everything I'm doing (pattern 13)
  (tabs)/calendars.tsx                      My calendars (pattern 1)
  calendar/[calendarId]/index.tsx           Calendar: day pills, members, events
  calendar/[calendarId]/day/[date].tsx      One day
  calendar/[calendarId]/event/[eventId].tsx Event detail
src/
  db/       SQLite mirror: schema, seed fixtures, queries
  components/
  lib/      formatting and the query hook
  theme.ts  design tokens, light and dark
```

Two tabs, not three: Discover is designed but hidden until the catalogue ships,
because a visible dead tab makes the app feel unfinished (§3.5).

## The data layer is not a mock

Every screen reads synchronously from SQLite, which is exactly what §5.6
specifies for the finished app — the network is a background writer, not
something a screen waits on. So this is the real read path with the sync engine
absent, not a throwaway prototype. Writes already go through `mutation_queue`,
and the sync banner already reports its depth.

Attendance resolution and every authorisation rule come from `@uca/core`, so the
client and the future API cannot drift apart.

## Known limitation: web

`npx expo export --platform ios` and `--platform android` bundle cleanly. **Web
bundles but does not run**: `expo-sqlite`'s synchronous API (`openDatabaseSync`)
depends on `SharedArrayBuffer` and a sync-access worker, and fails with "Sync
operation timeout" even with cross-origin isolation headers set.

Two ways out, when web matters:

1. **Hydrate once, read from memory.** Load a calendar's rows asynchronously on
   entry into an in-memory cache, keep all reads synchronous against that, and
   write through to SQLite. Preserves §5.6's no-loading-state rule on every
   platform, and is closer to what the app will want at scale anyway.
2. **Async reads on web only.** Smaller change, but it reintroduces a loading
   state on the platform where it is most visible.

Neither is urgent: v1's website is a thin acquisition surface (§13.9), not this
app running in a browser.
