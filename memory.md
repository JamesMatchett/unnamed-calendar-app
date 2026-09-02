# UCA — working memory

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
| Infrastructure code | Not started — Terraform, per §3.6 |

**Next artefact:** the Terraform DynamoDB table definition plus the TypeScript item types in
`packages/core`. That is where the one-way doors get pinned down.

## Still open

1. Confirm how Cognito bills **Apple/Google federation** before relying on the Lite tier —
   OIDC federation is priced separately with only 50 free MAUs (§13.1).
2. **Festival source licensing** — blocks the catalogue work, deferred with it (§13.3).
3. **Change-log retention** — 90 days assumed, never validated (§13.4).
4. **Group size ceiling** — above roughly 500 members, "one query returns the whole calendar"
   needs pagination (§13.5).
5. **The name.**

## Conventions

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

## Things deliberately not built

Recorded so they are not re-proposed as oversights: comments and discussion threads,
plus-ones on RSVPs, email/password authentication, public or discoverable calendars, a friends
graph, a month grid on mobile, and a permanent ban on removed members. Each has a rationale in
Architecture.md; see §8.6 and the decisions log.
