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

export function seedIfEmpty(db: SQLite.SQLiteDatabase): void {
  const row = db.getFirstSync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM calendars",
  );
  if ((row?.n ?? 0) > 0) return;

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
        id: "01JC0EVTFLIGHT0000000000",
        cid: "01JC0CALLISBON0000000000",
        title: "Flights land",
        desc: "Priya and Luke are on the earlier one.",
        start: day(12, 15, 40),
        end: null,
        tz: "Europe/Lisbon",
        precision: "datetime",
        loc: "Humberto Delgado Airport",
        addr: "Alameda das Comunidades Portuguesas, Lisboa",
        tickets: 0,
        url: null,
        by: CURRENT_USER_ID,
        rrule: null,
      },
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
