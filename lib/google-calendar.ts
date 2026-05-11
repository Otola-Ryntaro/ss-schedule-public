// where: lib/google-calendar.ts
// what:  Thin wrapper around googleapis (Google Calendar v3) for (1) listing the user's
//        writable calendars and (2) inserting an event from an ExtractedEvent.
// why:   Isolating googleapis here keeps the rest of the app SDK-agnostic.
//        Server-only: the access token is taken as an argument (callers obtain it via
//        lib/auth-token.ts inside an API Route) and is never exposed to the client.
//        Date assembly rules:
//          - Timed events: { dateTime, timeZone: "Asia/Tokyo" } only.
//          - All-day events: { date: "YYYY-MM-DD", timeZone: "Asia/Tokyo" } only.
//            end.date is derived from event.endISO (not startISO+1day) so that multi-day
//            and user-edited end dates are honoured. SS-002 is responsible for placing
//            the Google-exclusive end date into endISO.
//        SDK errors bubble up unwrapped; the SS-007 API Route maps them to HTTP responses.

import { google } from "googleapis";
import type { CalendarListEntry, ConflictEvent, ExtractedEvent } from "./schema";

// Re-exported from schema.ts so client components can import the type without
// dragging googleapis into the browser bundle (SS-010 prep).
export type { CalendarListEntry } from "./schema";

const TIME_ZONE = "Asia/Tokyo";

// Build a per-call OAuth2 client and Calendar v3 client. We construct fresh clients
// per request because the access token is request-scoped (Auth.js refreshes it in jwt()).
function buildCalendarClient(accessToken: string) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return google.calendar({ version: "v3", auth });
}

export async function listCalendars(
  accessToken: string,
): Promise<CalendarListEntry[]> {
  const calendar = buildCalendarClient(accessToken);
  const res = await calendar.calendarList.list();
  const items = res.data.items ?? [];

  const result: CalendarListEntry[] = [];
  for (const item of items) {
    if (item.accessRole !== "writer" && item.accessRole !== "owner") continue;
    if (typeof item.id !== "string" || typeof item.summary !== "string") continue;
    result.push({
      id: item.id,
      summary: item.summary,
      primary: item.primary === true,
      accessRole: item.accessRole,
    });
  }
  return result;
}

// Combine description and url per the SS-005 spec: url goes at the end of description,
// separated by a blank line. Returns undefined when both are null so the field is omitted.
function buildDescription(
  description: string | null,
  url: string | null,
): string | undefined {
  if (description && url) return `${description}\n\n${url}`;
  if (description) return description;
  if (url) return url;
  return undefined;
}

type EventDateTime =
  | { dateTime: string; timeZone: string }
  | { date: string; timeZone: string };

function buildStartEnd(event: ExtractedEvent): {
  start: EventDateTime;
  end: EventDateTime;
} {
  if (event.isAllDay) {
    // Safe: schema.ts JSTOffsetISO enforces "+09:00" suffix, so slice(0,10) is the JST date.
    return {
      start: { date: event.startISO.slice(0, 10), timeZone: TIME_ZONE },
      end: { date: event.endISO.slice(0, 10), timeZone: TIME_ZONE },
    };
  }
  return {
    start: { dateTime: event.startISO, timeZone: TIME_ZONE },
    end: { dateTime: event.endISO, timeZone: TIME_ZONE },
  };
}

export async function insertEvent(
  accessToken: string,
  calendarId: string,
  event: ExtractedEvent,
): Promise<{ htmlLink: string; id: string }> {
  const calendar = buildCalendarClient(accessToken);
  const { start, end } = buildStartEnd(event);
  const description = buildDescription(event.description, event.url);

  const requestBody: Record<string, unknown> = {
    // Google Calendar API uses "summary" for the event title.
    summary: event.title,
    start,
    end,
  };
  if (event.location) requestBody.location = event.location;
  if (description !== undefined) requestBody.description = description;

  const res = await calendar.events.insert({
    calendarId,
    requestBody,
  });

  const id = res.data.id;
  const htmlLink = res.data.htmlLink;
  if (typeof id !== "string" || typeof htmlLink !== "string") {
    throw new Error("Calendar API returned no id or htmlLink");
  }
  return { id, htmlLink };
}

// ───────────────────────────────────────────────
// SS-014: Double-booking detection
// ───────────────────────────────────────────────

// Minimal shape we read from googleapis Event objects. Kept SDK-agnostic so
// detectConflicts can be unit-tested without googleapis types.
export type RawCalendarEvent = {
  id?: string | null;
  summary?: string | null;
  start?: { dateTime?: string | null; date?: string | null } | null;
  end?: { dateTime?: string | null; date?: string | null } | null;
};

// All-day events come back with `date` only ("YYYY-MM-DD"). We anchor them at
// JST 00:00 for numeric comparison. `dateTime` carries its own offset and is
// parsed verbatim — Date.parse normalises to UTC ms, so cross-TZ events compare
// correctly without manual offset math.
function eventInstantMs(
  slot: { dateTime?: string | null; date?: string | null } | null | undefined,
): number | null {
  if (!slot) return null;
  if (slot.dateTime) {
    const ms = Date.parse(slot.dateTime);
    return Number.isNaN(ms) ? null : ms;
  }
  if (slot.date) {
    const ms = Date.parse(`${slot.date}T00:00:00+09:00`);
    return Number.isNaN(ms) ? null : ms;
  }
  return null;
}

// Pure half-open overlap check. Events are considered conflicting when
// newStart < existingEnd && newEnd > existingStart. Events with missing id
// or unparseable start/end are skipped defensively.
export function detectConflicts(
  events: RawCalendarEvent[],
  newStartISO: string,
  newEndISO: string,
): ConflictEvent[] {
  const newStartMs = Date.parse(newStartISO);
  const newEndMs = Date.parse(newEndISO);
  if (Number.isNaN(newStartMs) || Number.isNaN(newEndMs)) return [];

  const conflicts: ConflictEvent[] = [];
  for (const event of events) {
    if (typeof event.id !== "string") continue;
    const startMs = eventInstantMs(event.start);
    const endMs = eventInstantMs(event.end);
    if (startMs === null || endMs === null) continue;
    if (!(newStartMs < endMs && newEndMs > startMs)) continue;

    const isAllDay = !event.start?.dateTime;
    const startISO = event.start?.dateTime
      ? event.start.dateTime
      : `${event.start?.date}T00:00:00+09:00`;
    const endISO = event.end?.dateTime
      ? event.end.dateTime
      : `${event.end?.date}T00:00:00+09:00`;

    conflicts.push({
      id: event.id,
      title: event.summary && event.summary.length > 0 ? event.summary : "(無題)",
      startISO,
      endISO,
      isAllDay,
    });
  }
  return conflicts;
}

// Side-effecting wrapper. timeMin/timeMax filter Google-side (start < timeMax
// && end > timeMin), so the new range alone is sufficient. singleEvents=true
// expands recurring instances. detectConflicts re-validates the result for
// type safety and consistent shaping.
export async function findConflictingEvents(
  accessToken: string,
  calendarId: string,
  startISO: string,
  endISO: string,
): Promise<ConflictEvent[]> {
  const calendar = buildCalendarClient(accessToken);
  const res = await calendar.events.list({
    calendarId,
    timeMin: startISO,
    timeMax: endISO,
    singleEvents: true,
    showDeleted: false,
    maxResults: 50,
    orderBy: "startTime",
  });
  const items = (res.data.items ?? []) as RawCalendarEvent[];
  return detectConflicts(items, startISO, endISO);
}
