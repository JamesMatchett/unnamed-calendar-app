/**
 * Fixture data, so the app has something to be judged against before there is a
 * backend. Two calendars deliberately chosen to exercise both modes from §4.3:
 * a bounded trip and a continuous city calendar.
 */

import type * as SQLite from "expo-sqlite";

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
  seedCalendars(db);
  seedInbox(db);
  seedPeople(db);
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
  if (count(db, "calendars") > 0) return;

  db.withTransactionSync(() => {
    db.runSync(
      `INSERT INTO calendars (calendar_id, name, description, mode, start_date, end_date,
         default_tz, collect_availability, require_approval, allow_member_invites,
         status, created_by, created_at, last_seq)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
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
         status, created_by, created_at, last_seq)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
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
      },
    ];

    for (const e of events) {
      db.runSync(
        `INSERT INTO events (event_id, calendar_id, title, description, start_utc, end_utc,
           tz, local_wall, precision, location_name, location_address, tickets_required,
           ticket_url, allow_suggestions, status, created_by, created_at, version, rrule, sync_state)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1,'active',?,?,1,?, 'synced')`,
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
        ],
      );
    }

    // Arrival and departure for the Lisbon trip. Deliberately staggered: two
    // people already there, one landing mid-trip, one who has not said.
    const availability: [string, string | null, string | null][] = [
      [CURRENT_USER_ID, day(12, 15, 40), day(15, 11, 0)],
      ["01JC0USERPRIYA0000000000", day(12, 9, 15), day(15, 11, 0)],
      ["01JC0USERLUKE00000000000", day(13, 18, 30), day(15, 20, 0)],
      ["01JC0USERGLENN0000000000", null, null],
    ];

    for (const [uid, arrives, departs] of availability) {
      db.runSync(
        `INSERT INTO availability (calendar_id, user_id, arrives_at, departs_at, updated_at)
         VALUES ('01JC0CALLISBON0000000000',?,?,?,?)`,
        [uid, arrives, departs, day(-10, 9)],
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
