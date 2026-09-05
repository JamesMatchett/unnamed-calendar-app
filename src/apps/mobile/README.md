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

## Updating Expo packages

`npx expo install --check` picks versions compatible with the SDK, which is
right, and then updates the lockfile **in place**, which in a workspaces
monorepo can quietly break the build. Always follow it with a full regeneration:

```sh
rm -rf node_modules src/*/*/node_modules package-lock.json
npm install
npm run verify
npm exec --workspace @calder/mobile -- expo export --platform ios
```

What goes wrong without it. npm updating a lockfile in place will sometimes
place a transitive dependency **nested** under its parent rather than hoisted —
`node_modules/expo/node_modules/expo-modules-core` instead of
`node_modules/expo-modules-core`. Node's own resolution walks up from the
importing file and finds it either way. **Metro does not**: it searches only the
roots it is configured with, so a nested package is invisible and the bundle
fails with "Unable to resolve module", naming a package that is sitting right
there on disk.

Three things make this worse than it sounds:

- `npm ci` does not fix it. It reproduces the lockfile exactly, including the
  placement, so it looks like a clean install and changes nothing.
- Deleting only the lockfile does not fix it either. npm reads the existing
  `node_modules` and preserves placements rather than deciding fresh. The
  directories have to go too, all four of them.
- `npm run verify` passes throughout. TypeScript resolves declarations, not the
  runtime module graph, so typecheck is green while the bundler cannot build.
  **Only `expo export` catches this**, which is why it is a separate step here
  rather than folded into `verify`.

The regeneration is also worth doing for its own sake: it collapsed duplicate
copies of `react` and `react-dom`, which is the usual cause of "invalid hook
call" and of context that mysteriously does not cross a boundary.

## Signing in

Authorization code with PKCE, through the system authentication sheet, against
Cognito's hosted endpoints. Not a WebView: Apple requires the system sheet for
OAuth, and it is also the only thing that hands the redirect back to the app.

Nothing about the pool is compiled in. `GET /v1/config` returns the client id,
the hosted domain and which providers are actually configured, so the sign-in
screen offers Apple alone until Google exists rather than a button that fails at
the provider. The client id is generated by Cognito rather than declared in
Terraform, so no check could hold a copy of it in step with the truth — and a
stale one baked into a build already on somebody's phone fails with an error
naming nothing useful.

Tokens go in the Keychain via expo-secure-store, `WHEN_UNLOCKED_THIS_DEVICE_ONLY`
so they do not travel to a new phone in a backup. Not in SQLite beside the
calendars: a refresh token lasts 180 days and is the one value here worth
stealing.

**Expo Go cannot complete this on a physical device.** Cognito matches callback
URLs exactly and `calandder://` only exists once the app is a real build; Expo
Go substitutes an `exp://` URL built from the machine's address. The simulator's
loopback form is in the allow-list, so the simulator works. A phone needs a dev
client:

```sh
npx expo run:ios
```

Settings > About this build has the two rows that prove it end to end. **Server**
calls `/v1/health` and reports which environment answered, which catches a build
pointed at the wrong one. **Account** calls `/v1/me` with the stored token and
shows the first eight characters of the ULID the Pre Token Generation trigger
minted. If that shows an id, everything between the phone and DynamoDB is
working. Sign in twice and it should be the same id.

`LOCAL_ONLY` is unaffected by any of this and stays `true`: signing in records
who you are, and every calendar and event still lives only on the phone.

## Which environment a build talks to

`app.json` holds everything static. `app.config.ts` adds the one thing that
cannot be static: the environment, read from `CALDER_ENV` and turned into an
API base URL that ships inside the bundle. `eas.json` sets that variable per
build profile.

| Profile | `CALDER_ENV` | Talks to |
|---|---|---|
| `development` | dev | `api.dev.calandder.com` |
| `preview` | dev | `api.dev.calandder.com` |
| `production` | prod | `api.calandder.com` |

Unset defaults to dev, so `npx expo start` needs nothing. An unrecognised value
throws while the config is read, rather than producing a build quietly pointed
somewhere it should not be. Check what a build would carry:

```sh
npx expo config --type public --json | jq .extra
CALDER_ENV=prod npx expo config --type public --json | jq .extra
```

The hostnames live in `app.config.ts` in source, because a compiled bundle
cannot look one up. That makes them a copy of a name Terraform owns, so
`check:infra` holds the two in step — the symptom otherwise appears on somebody
else's phone, and a build already in TestFlight cannot be fixed by an apply.

**`LOCAL_ONLY` is a different question** and stays `true`. It says whether there
is anywhere for a write to go, and there is not: sign-in needs Apple and Google
credentials that do not exist yet. Knowing which environment this build belongs
to, and being able to prove the phone can reach it, is useful before that and is
what Settings > Server does.
