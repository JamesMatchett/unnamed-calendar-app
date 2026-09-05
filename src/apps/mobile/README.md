# @calder/mobile

Expo / React Native app. SDK 57, React 19, new architecture on.

## Running it

Install once, from the **repo root** — npm workspaces installs core and the app
together, and installing from a subdirectory will not work:

```sh
cd <repo root> && npm install
```

After that, either directory works:

```sh
# from this directory
npm start

# or from the repo root
npm run mobile
```

Metro resolves `@calder/core` to its **TypeScript source**, so editing core hot-reloads exactly
like editing app code — no build step, and no chance of running new app code against a stale
`dist/`. `npm run build:core` remains for typechecking and the eventual Lambda bundles.

Then press `i` for the iOS simulator (needs Xcode) or `a` for Android. **Scanning
the QR with App Store Expo Go will not work** — the store build lags this SDK.
See `memory.md`, "Frontend and tooling traps".

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

Attendance resolution and every authorisation rule come from `@calder/core`, so the
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
Starting project at /Users/jamesm/GitHub/unnamed-calendar-app/src/apps/mobile
Expo Autolinking module resolution enabled
Starting Metro Bundler

warning: Bundler cache is empty, rebuilding (this may take a minute)
Waiting on http://localhost:8081

Logs for your project will appear below.
