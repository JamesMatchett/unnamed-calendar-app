/**
 * Fixture data, so the app has something to be judged against before there is a
 * backend. Two calendars deliberately chosen to exercise both modes from §4.3:
 * a bounded trip and a continuous city calendar.
 */

import type { TravelMode } from "@uca/core";
import type * as SQLite from "expo-sqlite";

/**
 * Bumped by `npm run reseed`, which rewrites the line below with the current
 * time. Fixture dates are relative to WHEN THEY WERE SEEDED, so a database from
 * last month shows a trip that has already happened; changing this makes the app
 * drop the fixtures and rebuild them starting from today.
 */
export const FIXTURE_EPOCH = "2026-09-03T00:56:39.072Z";

/** Stands in for the signed-in user until Cognito exists (§3.2). */
export const CURRENT_USER_ID = "01JC0USERJAMES0000000000";

const day = (offset: number, hour: number, minute = 0): string => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  d.setUTCHours(hour, minute, 0, 0);
  return d.toISOString();
};

const isoDate = (offset: number): string => day(offset, 12).slice(0, 10);

/**
 * Each area seeds independently. A single "is the database empty?" check means
 * that adding fixtures later never reaches anyone who already ran the app —
 * they get new empty tables and assume the feature is broken.
 */
export function seedIfEmpty(db: SQLite.SQLiteDatabase): void {
  ensureOwnPlans(db);
  seedCalendars(db);
  seedInbox(db);
  seedPeople(db);
  seedJoinable(db);
  seedJoinRequest(db);
  seedPrivate(db);
  seedSuggestion(db);
  seedCancelled(db);
  seedBusyDay(db);
  seedThisWeek(db);
}


/** The id every account's own private calendar gets, until real user ids exist. */
export const OWN_PLANS_ID = "01JC0CALSOLO000000000000";

/**
 * Everyone starts with somewhere private to put things.
 *
 * This is NOT a fixture: it is the app's behaviour, and the API will do the same
 * on sign-up (§8.1). An empty Calendars tab gives a new user nowhere to add an
 * event to, so the first thing they can do is nothing. It is created here, guarded
 * on its own existence, so it survives a fixture reset and a user who deletes
 * every other calendar.
 */
function ensureOwnPlans(db: SQLite.SQLiteDatabase): void {
  const exists = db.getFirstSync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM calendars WHERE calendar_id = ?",
    [OWN_PLANS_ID],
  );
  if ((exists?.n ?? 0) > 0) return;

  db.withTransactionSync(() => {
    db.runSync(
      `INSERT INTO calendars (calendar_id, name, description, mode, default_tz,
         collect_availability, travel_mode, require_approval, allow_member_invites,
         allow_member_events, is_private, status, created_by, created_at, last_seq)
       VALUES (?, 'My own plans', 'Things only I would say yes to.', 'continuous',
               'Europe/London', 0, 'walk', 1, 0, 1, 1, 'active', ?, ?, 0)`,
      [OWN_PLANS_ID, CURRENT_USER_ID, new Date().toISOString()],
    );
    db.runSync(
      `INSERT INTO members (calendar_id, user_id, role, status, display_name, joined_at)
       VALUES (?,?, 'owner', 'active', 'James', ?)`,
      [OWN_PLANS_ID, CURRENT_USER_ID, new Date().toISOString()],
    );
  });
}

/**
 * Something on every day of the current week.
 *
 * The other fixtures are shaped around particular cases (a trip, a busy day, a
 * cancellation) and between them they leave most of this week empty, which makes
 * the week strip and its dots look broken rather than quiet. This fills the gaps
 * with ordinary weeknight plans, spread across the answers so every dot colour
 * appears somewhere in the first seven days.
 *
 * Dev fixtures only. Guarded on its own ids, so `npm run reseed` rebuilds it
 * relative to whatever "today" is then.
 */
function seedThisWeek(db: SQLite.SQLiteDatabase): void {
  const exists = db.getFirstSync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM events WHERE event_id LIKE '01JC0EVTWEEK%'",
  );
  if ((exists?.n ?? 0) > 0) return;

  const london = db.getFirstSync<{ calendar_id: string }>(
    "SELECT calendar_id FROM calendars WHERE calendar_id = ?",
    ["01JC0CALLONDON0000000000"],
  );
  if (!london) return;

  const solo = OWN_PLANS_ID;

  // offset, hour, title, where, calendar, my answer, who added it
  const plan: [number, number, string, string, string, string | null, string][] = [
    [0, 8, "Gym before work", "Rowans", solo, "going", CURRENT_USER_ID],
    [0, 19, "Dinner at Brat", "Brat, Shoreditch", london.calendar_id, "going", "01JC0USERPRIYA0000000000"],
    [0, 21, "Late film at the Rio", "Rio Cinema", london.calendar_id, null, "01JC0USERLUKE00000000000"],
    [1, 13, "Lunch with Glenn", "Rochelle Canteen", london.calendar_id, "going", "01JC0USERGLENN0000000000"],
    [1, 20, "Board games at Luke's", "Luke's flat", london.calendar_id, "maybe", "01JC0USERLUKE00000000000"],
    [2, 11, "Broadway Market", "Broadway Market", london.calendar_id, null, "01JC0USERPRIYA0000000000"],
    [2, 18, "Priya's birthday drinks", "The Culpeper", london.calendar_id, "going", "01JC0USERPRIYA0000000000"],
    [3, 10, "Long run", "Victoria Park", solo, "going", CURRENT_USER_ID],
    [3, 16, "Roast at the Anchor", "The Anchor", london.calendar_id, "not_going", "01JC0USERGLENN0000000000"],
    [4, 9, "Dentist", "Hoxton Dental", solo, "going", CURRENT_USER_ID],
    [4, 19, "Pub quiz", "The Sebright Arms", london.calendar_id, "maybe", "01JC0USERLUKE00000000000"],
    [5, 18, "Climbing at the Castle", "Castle Climbing Centre", london.calendar_id, null, "01JC0USERLUKE00000000000"],
    [6, 12, "Sunday lunch with Mum", "Hers", solo, "going", CURRENT_USER_ID],
  ];

  db.withTransactionSync(() => {
    plan.forEach(([offset, hour, title, place, calendarId, answer, by], i) => {
      const id = `01JC0EVTWEEK${String(i).padStart(12, "0")}`;
      const start = day(offset, hour, 0);

      db.runSync(
        `INSERT INTO events (event_id, calendar_id, title, description, start_utc, end_utc,
           tz, local_wall, precision, location_name, location_address, tickets_required,
           ticket_url, allow_suggestions, status, created_by, created_at, version, rrule, image_key, sync_state)
         VALUES (?,?,?,NULL,?,?, 'Europe/London', ?, 'datetime', ?, NULL, 0, NULL, 1,
                 'active', ?, ?, 1, NULL, NULL, 'synced')`,
        [
          id,
          calendarId,
          title,
          start,
          day(offset, hour + 2, 0),
          start.slice(0, 19),
          place,
          by,
          day(-7, 9),
        ],
      );

      if (answer) {
        db.runSync(
          `INSERT INTO rsvps (event_id, occurrence, user_id, calendar_id, status, responded_at, sync_state)
           VALUES (?, '-', ?, ?, ?, ?, 'synced')`,
          [id, CURRENT_USER_ID, calendarId, answer, day(-1, 9)],
        );
      }
    });
  });
}

/**
 * A deliberately overloaded day, so the collapsed "3+" marker on the week strip
 * and the month grid has something to collapse. Six events across one Saturday,
 * spread over the answers, because the interesting case is not "busy" but "busy
 * in four different states at once".
 */
function seedBusyDay(db: SQLite.SQLiteDatabase): void {
  const exists = db.getFirstSync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM events WHERE event_id LIKE '01JC0EVTBUSY%'",
  );
  if ((exists?.n ?? 0) > 0) return;

  const calendar = db.getFirstSync<{ calendar_id: string }>(
    "SELECT calendar_id FROM calendars WHERE calendar_id = ?",
    ["01JC0CALLONDON0000000000"],
  );
  if (!calendar) return;

  // Far enough out that it never lands in the past, close enough to be inside
  // the first week the agenda shows.
  const OFFSET = 6;

  const plan: [id: string, title: string, hour: number, place: string, answer: string | null][] = [
    ["01JC0EVTBUSY1000000000000", "Coffee at Ozone", 9, "Ozone Coffee", "going"],
    ["01JC0EVTBUSY2000000000000", "Columbia Road flowers", 11, "Columbia Road", "going"],
    ["01JC0EVTBUSY3000000000000", "Lunch at Smoking Goat", 13, "Smoking Goat", "going"],
    ["01JC0EVTBUSY4000000000000", "Tate Modern, Turbine Hall", 15, "Tate Modern", "maybe"],
    ["01JC0EVTBUSY5000000000000", "Drinks at Satan's Whiskers", 19, "Satan's Whiskers", null],
    ["01JC0EVTBUSY6000000000000", "Late set at Corsica Studios", 23, "Corsica Studios", "not_going"],
  ];

  db.withTransactionSync(() => {
    for (const [id, title, hour, place, answer] of plan) {
      const start = day(OFFSET, hour, 0);
      db.runSync(
        `INSERT INTO events (event_id, calendar_id, title, description, start_utc, end_utc,
           tz, local_wall, precision, location_name, location_address, tickets_required,
           ticket_url, allow_suggestions, status, created_by, created_at, version, rrule, image_key, sync_state)
         VALUES (?,?,?,NULL,?,?, 'Europe/London', ?, 'datetime', ?, NULL, 0, NULL, 1,
                 'active', ?, ?, 1, NULL, NULL, 'synced')`,
        [
          id,
          calendar.calendar_id,
          title,
          start,
          day(OFFSET, hour + 1, 0),
          start.slice(0, 19),
          place,
          "01JC0USERPRIYA0000000000",
          day(-5, 9),
        ],
      );

      if (answer) {
        db.runSync(
          `INSERT INTO rsvps (event_id, occurrence, user_id, calendar_id, status, responded_at, sync_state)
           VALUES (?, '-', ?, ?, ?, ?, 'synced')`,
          [id, CURRENT_USER_ID, calendar.calendar_id, answer, day(-4, 9)],
        );
      }
    }
  });
}

/**
 * One cancelled event, because "called off" is a state the whole app has to
 * render and there was nothing exercising it: the agenda badge, the struck
 * title and the exclusion from the dot counts were all untested by eye.
 */
function seedCancelled(db: SQLite.SQLiteDatabase): void {
  const exists = db.getFirstSync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM events WHERE status = 'cancelled'",
  );
  if ((exists?.n ?? 0) > 0) return;

  const calendar = db.getFirstSync<{ calendar_id: string }>(
    "SELECT calendar_id FROM calendars WHERE calendar_id = ?",
    ["01JC0CALLONDON0000000000"],
  );
  if (!calendar) return;

  const start = day(3, 20, 0);
  db.runSync(
    `INSERT OR IGNORE INTO events (event_id, calendar_id, title, description, start_utc, end_utc,
       tz, local_wall, precision, location_name, location_address, tickets_required,
       ticket_url, allow_suggestions, status, created_by, created_at, version, rrule, image_key, sync_state)
     VALUES (?,?,?,?,?,?, 'Europe/London', ?, 'datetime', ?, NULL, 0, NULL, 1,
             'cancelled', ?, ?, 2, NULL, NULL, 'synced')`,
    [
      "01JC0EVTQUIZ0000000000000",
      calendar.calendar_id,
      "Pub quiz at the Dove",
      "Called off, the quizmaster is away.",
      start,
      day(3, 22, 0),
      start.slice(0, 19),
      "The Dove",
      "01JC0USERPRIYA0000000000",
      day(-6, 9),
    ],
  );
}

/**
 * A live suggestion on an event I own, so the approve/deny screen has something
 * to show. It targets the Fado night because that one is mine: a suggestion on
 * someone else's event would be theirs to answer, not mine.
 */
function seedSuggestion(db: SQLite.SQLiteDatabase): void {
  const exists = db.getFirstSync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM suggestions",
  );
  if ((exists?.n ?? 0) > 0) return;

  const event = db.getFirstSync<{ event_id: string; calendar_id: string }>(
    "SELECT event_id, calendar_id FROM events WHERE event_id = ?",
    ["01JC0EVTFADO000000000000"],
  );
  if (!event) return;

  db.withTransactionSync(() => {
    db.runSync(
      `INSERT INTO suggestions (suggestion_id, event_id, calendar_id, suggested_by,
         suggested_by_name, created_at, note, changes, base_version, status)
       VALUES (?,?,?,?,?,?,?,?,1,'pending')`,
      [
        "01JC0SUGFADO0000000000000",
        event.event_id,
        event.calendar_id,
        "01JC0USERGLENN0000000000",
        "Glenn",
        day(-2, 16),
        "Second show is cheaper and we would not have to rush dinner.",
        JSON.stringify({
          start_utc: day(13, 21, 30),
          end_utc: day(13, 23, 30),
          location_name: "Clube de Fado (late show)",
          description:
            "Late show. Tickets are limited, grab them early.",
        }),
      ],
    );

    // The notification is the way in, so it has to point at the event.
    db.runSync(
      "UPDATE notifications SET event_id = ? WHERE notification_id = 'n5'",
      [event.event_id],
    );
  });
}

/** The private case that is not automatic: a calendar shared with one person. */
function seedPrivate(db: SQLite.SQLiteDatabase): void {
  // Guarded on this calendar specifically, not on "any private calendar":
  // everyone now has one of those from the moment they open the app.
  const exists = db.getFirstSync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM calendars WHERE calendar_id = ?",
    ["01JC0CALUSTWO00000000000"],
  );
  if ((exists?.n ?? 0) > 0) return;

  db.withTransactionSync(() => {
    const rows: [string, string, string, string | null][] = [
      [
        "01JC0CALUSTWO00000000000",
        "Me and Priya",
        "Ours. Nobody else needs to see it.",
        "01JC0USERPRIYA0000000000",
      ],
    ];

    for (const [cid, name, description, other] of rows) {
      db.runSync(
        `INSERT INTO calendars (calendar_id, name, description, mode, default_tz,
           collect_availability, travel_mode, require_approval, allow_member_invites,
           allow_member_events, is_private, status, created_by, created_at, last_seq)
         VALUES (?,?,?, 'continuous', 'Europe/London', 0, 'walk', 1, 0, 1, 1,
                 'active', ?, ?, 0)`,
        [cid, name, description, CURRENT_USER_ID, day(-60, 9)],
      );
      db.runSync(
        `INSERT INTO members (calendar_id, user_id, role, status, display_name, joined_at)
         VALUES (?,?, 'owner', 'active', 'James', ?)`,
        [cid, CURRENT_USER_ID, day(-60, 9)],
      );
      if (other) {
        db.runSync(
          `INSERT INTO members (calendar_id, user_id, role, status, display_name, joined_at)
           VALUES (?,?, 'owner', 'active', 'Priya', ?)`,
          [cid, other, day(-60, 9)],
        );
      }
    }

    db.runSync(
      `INSERT INTO events (event_id, calendar_id, title, start_utc, tz, local_wall,
         precision, tickets_required, allow_suggestions, status, created_by, created_at, version, sync_state)
       VALUES ('01JC0EVTROAST00000000000', '01JC0CALUSTWO00000000000', 'Sunday roast at the Anchor',
               ?, 'Europe/London', ?, 'datetime', 0, 1, 'active', ?, ?, 1, 'synced')`,
      [day(4, 13, 0), day(4, 13, 0).slice(0, 19), CURRENT_USER_ID, day(-10, 9)],
    );
    db.runSync("UPDATE events SET image_key = 'roast' WHERE event_id = '01JC0EVTROAST00000000000'");
  });
}

/**
 * A calendar the current user is NOT a member of, with a live invite link.
 *
 * Without one there is no way to exercise the join flow: every seeded calendar
 * already has them in it, and a preview of something you have already joined
 * proves nothing. Guarded on its own existence rather than the schema version,
 * so adding it costs nobody their data.
 */
export const DEMO_INVITE_TOKEN = "glasto2027";

function seedJoinable(db: SQLite.SQLiteDatabase): void {
  const exists = db.getFirstSync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM calendars WHERE calendar_id = ?",
    ["01JC0CALGLASTO0000000000"],
  );
  if ((exists?.n ?? 0) > 0) return;

  db.withTransactionSync(() => {
    db.runSync(
      `INSERT INTO calendars (calendar_id, name, description, mode, start_date, end_date,
         default_tz, collect_availability, travel_mode, require_approval,
         allow_member_invites, allow_member_events, status, created_by, created_at, last_seq, cover_image)
       VALUES (?,?,?,'bounded',?,?, 'Europe/London', 1, 'car', 1, 1, 1, 'active', ?, ?, 0, 'glastonbury')`,
      [
        "01JC0CALGLASTO0000000000",
        "Glastonbury 2027",
        "Worthy Farm. Priya has the tickets, somehow.",
        isoDate(280),
        isoDate(284),
        "01JC0USERPRIYA0000000000",
        day(-40, 9),
      ],
    );

    const members: [string, string, string][] = [
      ["01JC0USERPRIYA0000000000", "owner", "Priya"],
      ["01JC0USERGLENN0000000000", "member", "Glenn"],
      ["01JC0USERLUKE00000000000", "member", "Luke"],
    ];
    for (const [uid, role, name] of members) {
      db.runSync(
        `INSERT INTO members (calendar_id, user_id, role, status, display_name, joined_at)
         VALUES ('01JC0CALGLASTO0000000000',?,?,'active',?,?)`,
        [uid, role, name, day(-40, 9)],
      );
    }

    const events: [string, string, string][] = [
      ["01JC0EVTPYRAMID000000000", "Pyramid Stage, whoever headlines", day(281, 21, 30)],
      ["01JC0EVTARRIVE0000000000", "Get the tent up", day(280, 14, 0)],
      ["01JC0EVTWEST00000000000A", "West Holts, all afternoon", day(282, 15, 0)],
    ];
    for (const [id, title, start] of events) {
      db.runSync(
        `INSERT INTO events (event_id, calendar_id, title, start_utc, tz, local_wall,
           precision, tickets_required, allow_suggestions, status, created_by, created_at, version, image_key, sync_state)
         VALUES (?, '01JC0CALGLASTO0000000000', ?, ?, 'Europe/London', ?, 'datetime', 1, 1,
                 'active', '01JC0USERPRIYA0000000000', ?, 1, 'glastonbury', 'synced')`,
        [id, title, start, start.slice(0, 19), day(-30, 9)],
      );
    }

    db.runSync(
      `INSERT INTO invite_links (calendar_id, token, created_at, uses)
       VALUES ('01JC0CALGLASTO0000000000', ?, ?, 2)`,
      [DEMO_INVITE_TOKEN, day(-5, 12)],
    );
  });
}

function seedPeople(db: SQLite.SQLiteDatabase): void {
  if (count(db, "directory") > 0) return;

  // Some of these share calendars with the current user and some do not — the
  // point of search is finding the ones who do not.
  const people: [string, string, string, string][] = [
    [CURRENT_USER_ID, "james", "James", "james@example.com"],
    ["01JC0USERPRIYA0000000000", "priya", "Priya Raman", "priya@example.com"],
    ["01JC0USERLUKE00000000000", "luke", "Luke Bennett", "luke@example.com"],
    ["01JC0USERGLENN0000000000", "glenn", "Glenn Ferreira", "glenn@example.com"],
    ["01JC0USERMAYA00000000000", "maya", "Maya Okonkwo", "maya@example.com"],
    ["01JC0USERTOM000000000000", "tomh", "Tom Hargreaves", "tom.h@example.com"],
    ["01JC0USERSOFIA0000000000", "sofia", "Sofia Almeida", "sofia@example.com"],
    ["01JC0USERDANNY0000000000", "dan", "Danny Whelan", "danny@example.com"],
  ];

  db.withTransactionSync(() => {
    for (const [id, handle, name, email] of people) {
      db.runSync(
        "INSERT INTO directory (user_id, handle, display_name, email) VALUES (?,?,?,?)",
        [id, handle, name, email],
      );
    }

    // A friendship that predates any shared calendar, an outgoing request and an
    // incoming one — so all three states are visible without having to create
    // them first.
    const friends: [string, string, string][] = [
      ["01JC0USERMAYA00000000000", "accepted", day(-200, 12)],
      ["01JC0USERTOM000000000000", "pending_out", day(-2, 15)],
      ["01JC0USERSOFIA0000000000", "pending_in", day(-1, 20)],
    ];

    for (const [uid, status, since] of friends) {
      db.runSync(
        "INSERT INTO friends (user_id, status, grants, since) VALUES (?,?,'none',?)",
        [uid, status, since],
      );
    }
  });
}

function count(db: SQLite.SQLiteDatabase, table: string): number {
  return (
    db.getFirstSync<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`)?.n ?? 0
  );
}

function seedInbox(db: SQLite.SQLiteDatabase): void {
  if (count(db, "notifications") > 0 || count(db, "pending_invites") > 0) return;

  db.withTransactionSync(() => {
    // Invites waiting for an answer — the People surface.
    db.runSync(
      `INSERT INTO pending_invites (calendar_id, calendar_name, calendar_mode, start_date,
         end_date, event_count, member_count, invited_by_name, invited_at, state)
       VALUES (?,?,?,?,?,?,?,?,?, 'pending')`,
      [
        "01JC0CALGLASTO0000000000",
        "Glastonbury 2027",
        "bounded",
        isoDate(280),
        isoDate(284),
        9,
        6,
        "Priya",
        day(-1, 18),
      ],
    );

    db.runSync(
      `INSERT INTO pending_invites (calendar_id, calendar_name, calendar_mode, start_date,
         end_date, event_count, member_count, invited_by_name, invited_at, state)
       VALUES (?,?,?,?,?,?,?,?,?, 'pending')`,
      [
        "01JC0CALSUNDAY00000000000",
        "Sunday roasts",
        "continuous",
        null,
        null,
        3,
        4,
        "Glenn",
        day(-3, 12),
      ],
    );

    type Notif = [string, string, string | null, string, string, string, string | null, string | null];
    const notifs: Notif[] = [
      // kind, id, read_at, created, calendar_id, calendar_name, actor_name, event_title
      ["invite_pending", "n1", null, day(-1, 18), "01JC0CALGLASTO0000000000", "Glastonbury 2027", "Priya", null],
      ["invite_pending", "n2", null, day(-3, 12), "01JC0CALSUNDAY00000000000", "Sunday roasts", "Glenn", null],
      ["event_added", "n3", null, day(-1, 9), "01JC0CALLISBON0000000000", "Lisbon, October", "Luke", "Tram 28 and the viewpoints"],
      ["event_added", "n4", null, day(-2, 14), "01JC0CALLONDON0000000000", "London things", "Priya", "Jockstrap at EartH"],
      ["suggestion_received", "n5", null, day(-2, 16), "01JC0CALLISBON0000000000", "Lisbon, October", "Glenn", "Fado night in Alfama"],
      ["event_cancelled", "n6", day(-4, 8), day(-5, 11), "01JC0CALLONDON0000000000", "London things", "Priya", "Pub quiz"],
      ["rsvp_nudge", "n7", day(-4, 8), day(-4, 7), "01JC0CALLISBON0000000000", "Lisbon, October", "Priya", "Dinner at Time Out Market"],
    ];

    for (const [kind, id, readAt, createdAt, cid, cname, actor, title] of notifs) {
      db.runSync(
        `INSERT INTO notifications (notification_id, kind, created_at, read_at,
           calendar_id, calendar_name, event_id, event_title, actor_id, actor_name)
         VALUES (?,?,?,?,?,?,NULL,?,NULL,?)`,
        [id, kind, createdAt, readAt, cid, cname, title, actor],
      );
    }
  });
}

function seedCalendars(db: SQLite.SQLiteDatabase): void {
  // Guarded on the Lisbon calendar, NOT on "are there any calendars": every
  // account now starts with My own plans, so counting calendars would see that
  // one and conclude the fixtures had already been seeded — leaving a database
  // with a single empty calendar in it.
  const exists = db.getFirstSync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM calendars WHERE calendar_id = ?",
    ["01JC0CALLISBON0000000000"],
  );
  if ((exists?.n ?? 0) > 0) return;

  db.withTransactionSync(() => {
    db.runSync(
      `INSERT INTO calendars (calendar_id, name, description, mode, start_date, end_date,
         default_tz, collect_availability, require_approval, allow_member_invites,
         status, created_by, created_at, last_seq, cover_image)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'lisbon')`,
      [
        "01JC0CALLISBON0000000000",
        "Lisbon, October",
        "Four days. Someone please book the thing with the tiles.",
        "bounded",
        isoDate(12),
        isoDate(15),
        "Europe/Lisbon",
        1,
        1,
        1,
        "active",
        CURRENT_USER_ID,
        day(-30, 9),
        0,
      ],
    );

    db.runSync(
      `INSERT INTO calendars (calendar_id, name, description, mode, start_date, end_date,
         default_tz, collect_availability, require_approval, allow_member_invites,
         status, created_by, created_at, last_seq, cover_image)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'london')`,
      [
        "01JC0CALLONDON0000000000",
        "London things",
        "What we're each up to. Gatecrash freely.",
        "continuous",
        null,
        null,
        "Europe/London",
        0,
        1,
        1,
        "active",
        "01JC0USERPRIYA0000000000",
        day(-90, 9),
        0,
      ],
    );

    const members: [string, string, string, string][] = [
      ["01JC0CALLISBON0000000000", CURRENT_USER_ID, "owner", "James"],
      ["01JC0CALLISBON0000000000", "01JC0USERPRIYA0000000000", "owner", "Priya"],
      ["01JC0CALLISBON0000000000", "01JC0USERLUKE00000000000", "member", "Luke"],
      ["01JC0CALLISBON0000000000", "01JC0USERGLENN0000000000", "member", "Glenn"],
      // Maya shares my flight home, so the plane row has more than one name in
      // it: a grouping where every group holds exactly one person proves
      // nothing about grouping.
      ["01JC0CALLISBON0000000000", "01JC0USERMAYA00000000000", "member", "Maya"],
      ["01JC0CALLONDON0000000000", CURRENT_USER_ID, "member", "James"],
      ["01JC0CALLONDON0000000000", "01JC0USERPRIYA0000000000", "owner", "Priya"],
      ["01JC0CALLONDON0000000000", "01JC0USERLUKE00000000000", "member", "Luke"],
    ];

    for (const [cid, uid, role, name] of members) {
      db.runSync(
        `INSERT INTO members (calendar_id, user_id, role, status, display_name, joined_at)
         VALUES (?,?,?,'active',?,?)`,
        [cid, uid, role, name, day(-30, 9)],
      );
    }

    type EventSeed = {
      id: string;
      cid: string;
      title: string;
      desc: string | null;
      start: string;
      end: string | null;
      tz: string;
      precision: "datetime" | "date" | "tbc";
      loc: string | null;
      addr: string | null;
      tickets: number;
      url: string | null;
      by: string;
      rrule: string | null;
      image?: string;
    };

    const events: EventSeed[] = [
      {
        id: "01JC0EVTDINNER0000000000",
        cid: "01JC0CALLISBON0000000000",
        title: "Dinner at Time Out Market",
        desc: "No booking, get there before 8.",
        start: day(12, 19, 30),
        end: day(12, 22, 0),
        tz: "Europe/Lisbon",
        precision: "datetime",
        loc: "Time Out Market",
        addr: "Av. 24 de Julho 49, Lisboa",
        tickets: 0,
        url: null,
        by: "01JC0USERPRIYA0000000000",
        rrule: null,
        image: "market",
      },
      {
        id: "01JC0EVTTRAM000000000000",
        cid: "01JC0CALLISBON0000000000",
        title: "Tram 28 and the viewpoints",
        desc: null,
        start: day(13, 10, 0),
        end: null,
        tz: "Europe/Lisbon",
        precision: "date",
        loc: "Martim Moniz",
        addr: null,
        tickets: 0,
        url: null,
        by: "01JC0USERLUKE00000000000",
        rrule: null,
        image: "tram",
      },
      {
        id: "01JC0EVTFADO000000000000",
        cid: "01JC0CALLISBON0000000000",
        title: "Fado night in Alfama",
        desc: "Tickets are limited, grab them early.",
        start: day(13, 20, 0),
        end: day(13, 23, 0),
        tz: "Europe/Lisbon",
        precision: "datetime",
        loc: "Clube de Fado",
        addr: "R. de São João da Praça 92, Lisboa",
        tickets: 1,
        url: "https://example.com/tickets/fado",
        by: CURRENT_USER_ID,
        rrule: null,
        image: "fado",
      },
      {
        id: "01JC0EVTBEACH00000000000",
        cid: "01JC0CALLISBON0000000000",
        title: "Beach day, Costa da Caparica",
        desc: "Weather dependent. Time TBC.",
        start: day(14, 11, 0),
        end: null,
        tz: "Europe/Lisbon",
        precision: "tbc",
        loc: "Costa da Caparica",
        addr: null,
        tickets: 0,
        url: null,
        by: "01JC0USERGLENN0000000000",
        rrule: null,
        image: "beach",
      },
      {
        id: "01JC0EVTFOOTBALL00000000",
        cid: "01JC0CALLONDON0000000000",
        title: "Five-a-side",
        desc: "Same pitch, same time, bring the bibs.",
        start: day(2, 19, 0),
        end: day(2, 20, 0),
        tz: "Europe/London",
        precision: "datetime",
        loc: "Powerleague Shoreditch",
        addr: null,
        tickets: 0,
        url: null,
        by: "01JC0USERLUKE00000000000",
        rrule: "FREQ=WEEKLY;BYDAY=TU",
        image: "football",
      },
      {
        id: "01JC0EVTGIG0000000000000",
        cid: "01JC0CALLONDON0000000000",
        title: "Jockstrap at EartH",
        desc: null,
        start: day(5, 19, 30),
        end: day(5, 23, 0),
        tz: "Europe/London",
        precision: "datetime",
        loc: "EartH Hackney",
        addr: "11-17 Stoke Newington Rd, London",
        tickets: 1,
        url: "https://example.com/tickets/gig",
        by: "01JC0USERPRIYA0000000000",
        rrule: null,
        image: "gig",
      },
    ];

    for (const e of events) {
      db.runSync(
        `INSERT INTO events (event_id, calendar_id, title, description, start_utc, end_utc,
           tz, local_wall, precision, location_name, location_address, tickets_required,
           ticket_url, allow_suggestions, status, created_by, created_at, version, rrule, image_key, sync_state)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1,'active',?,?,1,?,?, 'synced')`,
        [
          e.id,
          e.cid,
          e.title,
          e.desc,
          e.start,
          e.end,
          e.tz,
          e.start.slice(0, 19),
          e.precision,
          e.loc,
          e.addr,
          e.tickets,
          e.url,
          e.by,
          day(-20, 9),
          e.rrule,
          e.image ?? null,
        ],
      );
    }

    // Arrival and departure for the Lisbon trip. Deliberately staggered: two
    // people already there, one landing mid-trip, one who has not said.
    //
    // Three different ways of travelling, because the departure rows group by
    // mode and sort by each group's earliest leaver, and a trip where everyone
    // flies exercises none of that. The last day reads train 07:30, then plane
    // 11:00, then car 20:00 — three rows, in that order, with two names sharing
    // the flight so the grouping has something to group.
    //
    // Glenn stays on the calendar's own mode (null) AND has no times, which is
    // the other case worth being able to see: someone who has not said a thing.
    const availability: [
      user: string,
      arrives: string | null,
      departs: string | null,
      mode: TravelMode | null,
    ][] = [
      [CURRENT_USER_ID, day(12, 15, 40), day(15, 11, 0), "plane"],
      ["01JC0USERPRIYA0000000000", day(12, 9, 15), day(15, 7, 30), "train"],
      ["01JC0USERLUKE00000000000", day(13, 18, 30), day(15, 20, 0), "car"],
      // A later flight out than me, then the same one home. The plane row
      // therefore shows BOTH shapes across the trip: two names with their own
      // times on the way out, and one clause with a shared time on the way
      // back. One fixture, both cases.
      ["01JC0USERMAYA00000000000", day(12, 21, 5), day(15, 11, 0), "plane"],
      ["01JC0USERGLENN0000000000", null, null, null],
    ];

    for (const [uid, arrives, departs, mode] of availability) {
      db.runSync(
        `INSERT INTO availability (calendar_id, user_id, arrives_at, departs_at, travel_mode, updated_at)
         VALUES ('01JC0CALLISBON0000000000',?,?,?,?,?)`,
        [uid, arrives, departs, mode, day(-10, 9)],
      );
    }

    const rsvps: [string, string, string, string][] = [
      ["01JC0EVTDINNER0000000000", "-", "01JC0USERPRIYA0000000000", "going"],
      ["01JC0EVTDINNER0000000000", "-", "01JC0USERLUKE00000000000", "going"],
      ["01JC0EVTDINNER0000000000", "-", "01JC0USERGLENN0000000000", "maybe"],
      ["01JC0EVTFADO000000000000", "-", "01JC0USERPRIYA0000000000", "going"],
      ["01JC0EVTFADO000000000000", "-", "01JC0USERLUKE00000000000", "not_going"],
      ["01JC0EVTGIG0000000000000", "-", "01JC0USERPRIYA0000000000", "going"],
    ];

    for (const [eid, occ, uid, status] of rsvps) {
      const cid = eid.includes("GIG")
        ? "01JC0CALLONDON0000000000"
        : "01JC0CALLISBON0000000000";
      db.runSync(
        `INSERT INTO rsvps (event_id, occurrence, user_id, calendar_id, status, responded_at, sync_state)
         VALUES (?,?,?,?,?,?, 'synced')`,
        [eid, occ, uid, cid, status, day(-5, 9)],
      );
    }
  });
}

/**
 * Someone waiting to be let into a calendar the current user owns.
 *
 * Without one, the approval half of ownership has nothing to act on and cannot
 * be judged: a settings screen with an empty queue looks the same whether the
 * feature works or not.
 */
export function seedJoinRequest(db: SQLite.SQLiteDatabase): void {
  const exists = db.getFirstSync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM join_requests WHERE calendar_id = ?",
    ["01JC0CALLISBON0000000000"],
  );
  if ((exists?.n ?? 0) > 0) return;

  db.runSync(
    `INSERT INTO join_requests (calendar_id, user_id, display_name, requested_at, via_token, previously_removed)
     VALUES ('01JC0CALLISBON0000000000', '01JC0USERSOFIA0000000000', 'Sofia Almeida', ?, 'lisbon-link', 0)`,
    [day(-1, 20)],
  );
}
