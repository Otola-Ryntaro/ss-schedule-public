// where: __tests__/google-calendar.test.ts
// what:  TDD tests for listCalendars / insertEvent in lib/google-calendar.ts.
// why:   googleapis is mocked module-wide so tests stay hermetic (no real API calls).
//        We assert (1) writer/owner filtering, (2) payload assembly for timed and all-day
//        events including endISO-derived end.date for multi-day all-day events.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtractedEvent } from "@/lib/schema";

// --- Mock googleapis before importing lib/google-calendar ---
// vi.mock is hoisted to the top of the file, so the factory cannot reference module-scope
// variables. We use vi.hoisted to create mocks that are themselves hoisted.
const { calendarListListMock, eventsInsertMock, eventsListMock, calendarFactoryMock } = vi.hoisted(() => {
  const calendarListListMock = vi.fn();
  const eventsInsertMock = vi.fn();
  const eventsListMock = vi.fn();
  const calendarFactoryMock = vi.fn(() => ({
    calendarList: { list: calendarListListMock },
    events: { insert: eventsInsertMock, list: eventsListMock },
  }));
  return { calendarListListMock, eventsInsertMock, eventsListMock, calendarFactoryMock };
});

vi.mock("googleapis", () => {
  class FakeOAuth2 {
    setCredentials = vi.fn();
  }
  return {
    google: {
      auth: { OAuth2: FakeOAuth2 },
      calendar: calendarFactoryMock,
    },
  };
});

import {
  detectConflicts,
  findConflictingEvents,
  insertEvent,
  listCalendars,
  type RawCalendarEvent,
} from "@/lib/google-calendar";

const ACCESS_TOKEN = "ya29.fake-access-token";

const baseTimedEvent: ExtractedEvent = {
  title: "歯医者",
  startISO: "2026-05-03T14:00:00+09:00",
  endISO: "2026-05-03T15:00:00+09:00",
  isAllDay: false,
  location: "渋谷",
  url: null,
  description: "予約済み",
};

const baseAllDayOneDay: ExtractedEvent = {
  title: "終日イベント",
  // SS-002 normalization: all-day uses 00:00 JST start and exclusive 00:00 JST next-day end.
  startISO: "2026-05-03T00:00:00+09:00",
  endISO: "2026-05-04T00:00:00+09:00",
  isAllDay: true,
  location: null,
  url: null,
  description: null,
};

const baseAllDayMultiDay: ExtractedEvent = {
  title: "合宿",
  // 2026-05-03 〜 2026-05-05 (3 days). Exclusive end => 2026-05-06 00:00 JST.
  startISO: "2026-05-03T00:00:00+09:00",
  endISO: "2026-05-06T00:00:00+09:00",
  isAllDay: true,
  location: null,
  url: null,
  description: null,
};

describe("listCalendars", () => {
  beforeEach(() => {
    calendarListListMock.mockReset();
    eventsInsertMock.mockReset();
    calendarFactoryMock.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns only writer / owner calendars and shapes them as CalendarListEntry", async () => {
    calendarListListMock.mockResolvedValueOnce({
      data: {
        items: [
          {
            id: "primary@example.com",
            summary: "Primary",
            primary: true,
            accessRole: "owner",
          },
          {
            id: "writer@example.com",
            summary: "Writer Cal",
            accessRole: "writer",
          },
          {
            id: "reader@example.com",
            summary: "Holidays",
            accessRole: "reader",
          },
          {
            id: "freebusy@example.com",
            summary: "Coworker",
            accessRole: "freeBusyReader",
          },
        ],
      },
    });

    const result = await listCalendars(ACCESS_TOKEN);

    expect(result).toEqual([
      {
        id: "primary@example.com",
        summary: "Primary",
        primary: true,
        accessRole: "owner",
      },
      {
        id: "writer@example.com",
        summary: "Writer Cal",
        primary: false,
        accessRole: "writer",
      },
    ]);
    expect(calendarListListMock).toHaveBeenCalledTimes(1);
  });

  it("returns an empty array when the API returns no items", async () => {
    calendarListListMock.mockResolvedValueOnce({ data: {} });
    const result = await listCalendars(ACCESS_TOKEN);
    expect(result).toEqual([]);
  });
});

describe("insertEvent", () => {
  beforeEach(() => {
    calendarListListMock.mockReset();
    eventsInsertMock.mockReset();
    calendarFactoryMock.mockClear();
    eventsInsertMock.mockResolvedValue({
      data: { id: "evt_123", htmlLink: "https://calendar.google.com/event?eid=evt_123" },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns { id, htmlLink } from the API response", async () => {
    const result = await insertEvent(ACCESS_TOKEN, "primary@example.com", baseTimedEvent);
    expect(result).toEqual({
      id: "evt_123",
      htmlLink: "https://calendar.google.com/event?eid=evt_123",
    });
  });

  it("builds a timed-event payload with start/end dateTime only (no date field)", async () => {
    await insertEvent(ACCESS_TOKEN, "primary@example.com", baseTimedEvent);

    expect(eventsInsertMock).toHaveBeenCalledTimes(1);
    const call = eventsInsertMock.mock.calls[0][0];
    expect(call.calendarId).toBe("primary@example.com");

    const body = call.requestBody;
    expect(body.summary).toBe("歯医者");
    expect(body.location).toBe("渋谷");
    expect(body.start).toEqual({
      dateTime: "2026-05-03T14:00:00+09:00",
      timeZone: "Asia/Tokyo",
    });
    expect(body.end).toEqual({
      dateTime: "2026-05-03T15:00:00+09:00",
      timeZone: "Asia/Tokyo",
    });
    // dateTime / date must not coexist
    expect(body.start.date).toBeUndefined();
    expect(body.end.date).toBeUndefined();
  });

  it("builds an all-day single-day payload with date fields derived from endISO (start=2026-05-03, end=2026-05-04)", async () => {
    await insertEvent(ACCESS_TOKEN, "primary@example.com", baseAllDayOneDay);

    const body = eventsInsertMock.mock.calls[0][0].requestBody;
    expect(body.start).toEqual({ date: "2026-05-03", timeZone: "Asia/Tokyo" });
    expect(body.end).toEqual({ date: "2026-05-04", timeZone: "Asia/Tokyo" });
    // dateTime must not appear on all-day events
    expect(body.start.dateTime).toBeUndefined();
    expect(body.end.dateTime).toBeUndefined();
  });

  it("builds an all-day multi-day payload using endISO directly (start=2026-05-03, end=2026-05-06; NOT startISO+1d)", async () => {
    await insertEvent(ACCESS_TOKEN, "primary@example.com", baseAllDayMultiDay);

    const body = eventsInsertMock.mock.calls[0][0].requestBody;
    expect(body.start).toEqual({ date: "2026-05-03", timeZone: "Asia/Tokyo" });
    // If the impl wrongly used startISO+1day, end.date would be "2026-05-04". Assert correct value.
    expect(body.end).toEqual({ date: "2026-05-06", timeZone: "Asia/Tokyo" });
    expect(body.start.dateTime).toBeUndefined();
    expect(body.end.dateTime).toBeUndefined();
  });

  it("never emits dateTime fields for all-day events (mixing guard)", async () => {
    await insertEvent(ACCESS_TOKEN, "primary@example.com", baseAllDayMultiDay);
    const body = eventsInsertMock.mock.calls[0][0].requestBody;
    const startKeys = Object.keys(body.start);
    const endKeys = Object.keys(body.end);
    expect(startKeys).not.toContain("dateTime");
    expect(endKeys).not.toContain("dateTime");
  });

  it("appends url to description with two newlines when both are present", async () => {
    const event: ExtractedEvent = {
      ...baseTimedEvent,
      description: "予約済み",
      url: "https://example.com/booking",
    };
    await insertEvent(ACCESS_TOKEN, "primary@example.com", event);
    const body = eventsInsertMock.mock.calls[0][0].requestBody;
    expect(body.description).toBe("予約済み\n\nhttps://example.com/booking");
  });

  it("uses url alone as description when description is null", async () => {
    const event: ExtractedEvent = {
      ...baseTimedEvent,
      description: null,
      url: "https://example.com/booking",
    };
    await insertEvent(ACCESS_TOKEN, "primary@example.com", event);
    const body = eventsInsertMock.mock.calls[0][0].requestBody;
    expect(body.description).toBe("https://example.com/booking");
  });

  it("leaves description as-is when url is null", async () => {
    const event: ExtractedEvent = {
      ...baseTimedEvent,
      description: "予約済み",
      url: null,
    };
    await insertEvent(ACCESS_TOKEN, "primary@example.com", event);
    const body = eventsInsertMock.mock.calls[0][0].requestBody;
    expect(body.description).toBe("予約済み");
  });

  it("omits description from the payload when both description and url are null", async () => {
    const event: ExtractedEvent = {
      ...baseTimedEvent,
      description: null,
      url: null,
    };
    await insertEvent(ACCESS_TOKEN, "primary@example.com", event);
    const body = eventsInsertMock.mock.calls[0][0].requestBody;
    expect(body.description).toBeUndefined();
  });

  it("rejects when API response lacks id or htmlLink", async () => {
    // Override the default beforeEach mock: simulate SDK returning id only (htmlLink missing).
    eventsInsertMock.mockReset();
    eventsInsertMock.mockResolvedValueOnce({ data: { id: "ev_x" } });
    await expect(
      insertEvent(ACCESS_TOKEN, "primary@example.com", baseTimedEvent),
    ).rejects.toThrow(/no id or htmlLink/i);
  });
});

// ───────────────────────────────────────────────
// SS-014: Double-booking detection
// ───────────────────────────────────────────────

describe("detectConflicts (pure)", () => {
  // New event range used for most tests: 2026-05-03 14:00 〜 15:00 JST.
  const NEW_START = "2026-05-03T14:00:00+09:00";
  const NEW_END = "2026-05-03T15:00:00+09:00";

  it("returns empty array when there are no events", () => {
    expect(detectConflicts([], NEW_START, NEW_END)).toEqual([]);
  });

  it("flags a fully-overlapping timed event", () => {
    const events: RawCalendarEvent[] = [
      {
        id: "evt_a",
        summary: "既存予定",
        start: { dateTime: "2026-05-03T13:30:00+09:00" },
        end: { dateTime: "2026-05-03T15:30:00+09:00" },
      },
    ];
    const conflicts = detectConflicts(events, NEW_START, NEW_END);
    expect(conflicts).toEqual([
      {
        id: "evt_a",
        title: "既存予定",
        startISO: "2026-05-03T13:30:00+09:00",
        endISO: "2026-05-03T15:30:00+09:00",
        isAllDay: false,
      },
    ]);
  });

  it("flags partial overlaps in both directions", () => {
    const events: RawCalendarEvent[] = [
      {
        id: "before",
        summary: "前にハミ出る",
        start: { dateTime: "2026-05-03T13:30:00+09:00" },
        end: { dateTime: "2026-05-03T14:30:00+09:00" },
      },
      {
        id: "after",
        summary: "後にハミ出る",
        start: { dateTime: "2026-05-03T14:45:00+09:00" },
        end: { dateTime: "2026-05-03T15:30:00+09:00" },
      },
    ];
    const conflicts = detectConflicts(events, NEW_START, NEW_END);
    expect(conflicts).toHaveLength(2);
    expect(conflicts.map((c) => c.id)).toEqual(["before", "after"]);
  });

  it("does NOT flag events touching only at the endpoint (half-open: newEnd === existingStart)", () => {
    const events: RawCalendarEvent[] = [
      {
        id: "touch_after",
        summary: "直後",
        start: { dateTime: "2026-05-03T15:00:00+09:00" },
        end: { dateTime: "2026-05-03T16:00:00+09:00" },
      },
      {
        id: "touch_before",
        summary: "直前",
        start: { dateTime: "2026-05-03T13:00:00+09:00" },
        end: { dateTime: "2026-05-03T14:00:00+09:00" },
      },
    ];
    expect(detectConflicts(events, NEW_START, NEW_END)).toEqual([]);
  });

  it("excludes non-overlapping events", () => {
    const events: RawCalendarEvent[] = [
      {
        id: "far_before",
        summary: "別時間帯",
        start: { dateTime: "2026-05-03T10:00:00+09:00" },
        end: { dateTime: "2026-05-03T11:00:00+09:00" },
      },
    ];
    expect(detectConflicts(events, NEW_START, NEW_END)).toEqual([]);
  });

  it("flags a timed event that overlaps an all-day existing event", () => {
    const events: RawCalendarEvent[] = [
      {
        id: "allday",
        summary: "終日予定",
        start: { date: "2026-05-03" },
        end: { date: "2026-05-04" }, // exclusive next day
      },
    ];
    const conflicts = detectConflicts(events, NEW_START, NEW_END);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      id: "allday",
      title: "終日予定",
      isAllDay: true,
    });
  });

  it("flags overlap between two all-day ranges", () => {
    const events: RawCalendarEvent[] = [
      {
        id: "trip",
        summary: "出張",
        start: { date: "2026-05-02" },
        end: { date: "2026-05-05" }, // 2026-05-02 〜 2026-05-04 (inclusive last day)
      },
    ];
    // New all-day on 5/3 〜 5/3 (exclusive end 5/4)
    const conflicts = detectConflicts(
      events,
      "2026-05-03T00:00:00+09:00",
      "2026-05-04T00:00:00+09:00",
    );
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].isAllDay).toBe(true);
  });

  it("uses '(無題)' when summary is missing or null", () => {
    const events: RawCalendarEvent[] = [
      {
        id: "no_title",
        summary: null,
        start: { dateTime: "2026-05-03T14:00:00+09:00" },
        end: { dateTime: "2026-05-03T15:00:00+09:00" },
      },
    ];
    const conflicts = detectConflicts(events, NEW_START, NEW_END);
    expect(conflicts[0].title).toBe("(無題)");
  });

  it("skips events missing id or start/end", () => {
    const events: RawCalendarEvent[] = [
      {
        // no id
        summary: "x",
        start: { dateTime: "2026-05-03T14:00:00+09:00" },
        end: { dateTime: "2026-05-03T15:00:00+09:00" },
      },
      {
        id: "no_start",
        summary: "y",
        start: null,
        end: { dateTime: "2026-05-03T15:00:00+09:00" },
      },
      {
        id: "no_end",
        summary: "z",
        start: { dateTime: "2026-05-03T14:00:00+09:00" },
        end: null,
      },
    ];
    expect(detectConflicts(events, NEW_START, NEW_END)).toEqual([]);
  });
});

describe("findConflictingEvents", () => {
  beforeEach(() => {
    eventsListMock.mockReset();
    calendarFactoryMock.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("calls events.list with timeMin/timeMax and singleEvents flags", async () => {
    eventsListMock.mockResolvedValueOnce({ data: { items: [] } });
    await findConflictingEvents(
      ACCESS_TOKEN,
      "primary@example.com",
      "2026-05-03T14:00:00+09:00",
      "2026-05-03T15:00:00+09:00",
    );
    expect(eventsListMock).toHaveBeenCalledTimes(1);
    expect(eventsListMock).toHaveBeenCalledWith({
      calendarId: "primary@example.com",
      timeMin: "2026-05-03T14:00:00+09:00",
      timeMax: "2026-05-03T15:00:00+09:00",
      singleEvents: true,
      showDeleted: false,
      maxResults: 50,
      orderBy: "startTime",
    });
  });

  it("returns formatted conflict events from API response", async () => {
    eventsListMock.mockResolvedValueOnce({
      data: {
        items: [
          {
            id: "evt_existing",
            summary: "既存",
            start: { dateTime: "2026-05-03T13:30:00+09:00" },
            end: { dateTime: "2026-05-03T15:30:00+09:00" },
          },
        ],
      },
    });
    const result = await findConflictingEvents(
      ACCESS_TOKEN,
      "primary@example.com",
      "2026-05-03T14:00:00+09:00",
      "2026-05-03T15:00:00+09:00",
    );
    expect(result).toEqual([
      {
        id: "evt_existing",
        title: "既存",
        startISO: "2026-05-03T13:30:00+09:00",
        endISO: "2026-05-03T15:30:00+09:00",
        isAllDay: false,
      },
    ]);
  });

  it("returns [] when the API returns no items", async () => {
    eventsListMock.mockResolvedValueOnce({ data: {} });
    const result = await findConflictingEvents(
      ACCESS_TOKEN,
      "primary@example.com",
      "2026-05-03T14:00:00+09:00",
      "2026-05-03T15:00:00+09:00",
    );
    expect(result).toEqual([]);
  });

  it("propagates SDK errors", async () => {
    eventsListMock.mockRejectedValueOnce(new Error("network down"));
    await expect(
      findConflictingEvents(
        ACCESS_TOKEN,
        "primary@example.com",
        "2026-05-03T14:00:00+09:00",
        "2026-05-03T15:00:00+09:00",
      ),
    ).rejects.toThrow(/network down/);
  });
});
