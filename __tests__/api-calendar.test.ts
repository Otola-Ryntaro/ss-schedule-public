// where: __tests__/api-calendar.test.ts
// what:  Tests for GET /api/calendar/list and POST /api/calendar/insert.
// why:   Routes wire together auth, CSRF (insert only), token retrieval, and the
//        google-calendar SDK wrappers. We mock @/auth, @/lib/auth-token,
//        @/lib/google-calendar so tests are hermetic.
//
// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { _resetForTests } from "@/lib/rate-limit";

// ───────────────────────────────────────────────
// Mocks
// ───────────────────────────────────────────────

const authMock = vi.fn();
const getTokenMock = vi.fn();
const listCalendarsMock = vi.fn();
const insertEventMock = vi.fn();
const findConflictingEventsMock = vi.fn();

vi.mock("@/auth", () => ({
  auth: () => authMock(),
}));

vi.mock("@/lib/auth-token", () => ({
  getAuthBearerEmail: () => null,
  getCalendarAccessToken: (...args: unknown[]) => getTokenMock(...args),
}));

vi.mock("@/lib/google-calendar", () => ({
  listCalendars: (...args: unknown[]) => listCalendarsMock(...args),
  insertEvent: (...args: unknown[]) => insertEventMock(...args),
  findConflictingEvents: (...args: unknown[]) => findConflictingEventsMock(...args),
}));

const ORIGINAL_AUTH_URL = process.env.AUTH_URL;

beforeEach(() => {
  process.env.AUTH_URL = "https://app.example.com";
  authMock.mockReset();
  getTokenMock.mockReset();
  listCalendarsMock.mockReset();
  insertEventMock.mockReset();
  findConflictingEventsMock.mockReset();
  // Default: no conflicts so existing happy-path tests proceed to insertEvent.
  findConflictingEventsMock.mockResolvedValue([]);
  _resetForTests();
});

afterEach(() => {
  if (ORIGINAL_AUTH_URL === undefined) delete process.env.AUTH_URL;
  else process.env.AUTH_URL = ORIGINAL_AUTH_URL;
  vi.resetModules();
});

// ───────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────

async function loadListRoute() {
  const mod = await import("@/app/api/calendar/list/route");
  return mod.GET as (req: NextRequest) => Promise<Response>;
}

async function loadInsertRoute() {
  const mod = await import("@/app/api/calendar/insert/route");
  return mod.POST as (req: NextRequest) => Promise<Response>;
}

function makeListRequest(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest("https://app.example.com/api/calendar/list", {
    method: "GET",
    headers: {
      origin: "https://app.example.com",
      "sec-fetch-site": "same-origin",
      ...headers,
    },
  });
}

function makeInsertRequest(
  body: unknown,
  headers: Record<string, string> = {},
): NextRequest {
  return new NextRequest("https://app.example.com/api/calendar/insert", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://app.example.com",
      "sec-fetch-site": "same-origin",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

const VALID_EVENT = {
  title: "歯医者",
  startISO: "2026-05-03T14:00:00+09:00",
  endISO: "2026-05-03T15:00:00+09:00",
  isAllDay: false,
  location: "渋谷",
  url: null,
  description: null,
};

const VALID_CALENDARS = [
  {
    id: "primary",
    summary: "primary",
    primary: true,
    accessRole: "owner" as const,
  },
];

// ───────────────────────────────────────────────
// /api/calendar/list (GET)
// ───────────────────────────────────────────────

describe("GET /api/calendar/list", () => {
  it("returns 401 when unauthenticated", async () => {
    authMock.mockResolvedValueOnce(null);
    const GET = await loadListRoute();
    const res = await GET(makeListRequest());
    expect(res.status).toBe(401);
  });

  it("returns 200 with calendars when authenticated", async () => {
    authMock.mockResolvedValueOnce({ user: { email: "u@example.com" } });
    getTokenMock.mockResolvedValueOnce("ya29.fake");
    listCalendarsMock.mockResolvedValueOnce(VALID_CALENDARS);
    const GET = await loadListRoute();
    const res = await GET(makeListRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ calendars: VALID_CALENDARS });
  });

  it("sets Cache-Control: private, no-store", async () => {
    authMock.mockResolvedValueOnce({ user: { email: "u@example.com" } });
    getTokenMock.mockResolvedValueOnce("ya29.fake");
    listCalendarsMock.mockResolvedValueOnce(VALID_CALENDARS);
    const GET = await loadListRoute();
    const res = await GET(makeListRequest());
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("returns 401 when access token is missing/expired", async () => {
    authMock.mockResolvedValueOnce({ user: { email: "u@example.com" } });
    getTokenMock.mockRejectedValueOnce(new Error("access_token_expired"));
    const GET = await loadListRoute();
    const res = await GET(makeListRequest());
    expect(res.status).toBe(401);
  });

  it("returns 502 when SDK call fails", async () => {
    authMock.mockResolvedValueOnce({ user: { email: "u@example.com" } });
    getTokenMock.mockResolvedValueOnce("ya29.fake");
    listCalendarsMock.mockRejectedValueOnce(new Error("network down"));
    const GET = await loadListRoute();
    const res = await GET(makeListRequest());
    expect(res.status).toBe(502);
  });
});

// ───────────────────────────────────────────────
// /api/calendar/insert (POST)
// ───────────────────────────────────────────────

describe("POST /api/calendar/insert", () => {
  it("returns 401 when unauthenticated", async () => {
    authMock.mockResolvedValueOnce(null);
    const POST = await loadInsertRoute();
    const res = await POST(
      makeInsertRequest({ calendarId: "primary", event: VALID_EVENT }),
    );
    expect(res.status).toBe(401);
  });

  it("returns 403 when origin is cross-site", async () => {
    authMock.mockResolvedValueOnce({ user: { email: "u@example.com" } });
    const POST = await loadInsertRoute();
    const res = await POST(
      makeInsertRequest(
        { calendarId: "primary", event: VALID_EVENT },
        { origin: "https://evil.example.com", "sec-fetch-site": "cross-site" },
      ),
    );
    expect(res.status).toBe(403);
  });

  it("returns 400 when body is missing calendarId", async () => {
    authMock.mockResolvedValueOnce({ user: { email: "u@example.com" } });
    const POST = await loadInsertRoute();
    const res = await POST(makeInsertRequest({ event: VALID_EVENT }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when event payload fails ExtractedEventSchema", async () => {
    authMock.mockResolvedValueOnce({ user: { email: "u@example.com" } });
    const POST = await loadInsertRoute();
    // Missing required title + invalid ISO offset.
    const badEvent = { ...VALID_EVENT, title: "", startISO: "2026-05-03T14:00:00Z" };
    const res = await POST(
      makeInsertRequest({ calendarId: "primary", event: badEvent }),
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when JSON body is malformed", async () => {
    authMock.mockResolvedValueOnce({ user: { email: "u@example.com" } });
    const POST = await loadInsertRoute();
    const req = new NextRequest("https://app.example.com/api/calendar/insert", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://app.example.com",
        "sec-fetch-site": "same-origin",
      },
      body: "{ not json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 200 + insertEvent result on success", async () => {
    authMock.mockResolvedValueOnce({ user: { email: "u@example.com" } });
    getTokenMock.mockResolvedValueOnce("ya29.fake");
    insertEventMock.mockResolvedValueOnce({
      id: "evt_123",
      htmlLink: "https://www.google.com/calendar/event?eid=evt_123",
    });
    const POST = await loadInsertRoute();
    const res = await POST(
      makeInsertRequest({ calendarId: "primary", event: VALID_EVENT }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      ok: true,
      id: "evt_123",
      htmlLink: "https://www.google.com/calendar/event?eid=evt_123",
    });
    expect(insertEventMock).toHaveBeenCalledWith(
      "ya29.fake",
      "primary",
      VALID_EVENT,
    );
  });

  it("returns 401 when access token is missing/expired", async () => {
    authMock.mockResolvedValueOnce({ user: { email: "u@example.com" } });
    getTokenMock.mockRejectedValueOnce(new Error("access_token_expired"));
    const POST = await loadInsertRoute();
    const res = await POST(
      makeInsertRequest({ calendarId: "primary", event: VALID_EVENT }),
    );
    expect(res.status).toBe(401);
  });

  it("returns 502 when insertEvent throws", async () => {
    authMock.mockResolvedValueOnce({ user: { email: "u@example.com" } });
    getTokenMock.mockResolvedValueOnce("ya29.fake");
    insertEventMock.mockRejectedValueOnce(new Error("calendar API 500"));
    const POST = await loadInsertRoute();
    const res = await POST(
      makeInsertRequest({ calendarId: "primary", event: VALID_EVENT }),
    );
    expect(res.status).toBe(502);
    const body = await res.json();
    // Error details must NOT leak to the client.
    expect(body.error).not.toContain("calendar API 500");
  });

  it("rate-limits repeated insert requests for the same user", async () => {
    authMock.mockResolvedValue({ user: { email: "rate@example.com" } });
    getTokenMock.mockResolvedValue("ya29.fake");
    insertEventMock.mockResolvedValue({
      id: "evt_123",
      htmlLink: "https://www.google.com/calendar/event?eid=evt_123",
    });
    const POST = await loadInsertRoute();

    for (let i = 0; i < 10; i++) {
      const res = await POST(
        makeInsertRequest({ calendarId: "primary", event: VALID_EVENT }),
      );
      expect(res.status).toBe(200);
    }

    const limited = await POST(
      makeInsertRequest({ calendarId: "primary", event: VALID_EVENT }),
    );
    expect(limited.status).toBe(429);
    expect(insertEventMock).toHaveBeenCalledTimes(10);
  });

  // ─── SS-014: Conflict detection ───

  const SAMPLE_CONFLICT = {
    id: "evt_existing",
    title: "既存予定",
    startISO: "2026-05-03T13:30:00+09:00",
    endISO: "2026-05-03T15:30:00+09:00",
    isAllDay: false,
  };

  it("returns 409 with conflicts array when overlapping events exist (confirmConflicts default false)", async () => {
    authMock.mockResolvedValueOnce({ user: { email: "u@example.com" } });
    getTokenMock.mockResolvedValueOnce("ya29.fake");
    findConflictingEventsMock.mockResolvedValueOnce([SAMPLE_CONFLICT]);
    const POST = await loadInsertRoute();
    const res = await POST(
      makeInsertRequest({ calendarId: "primary", event: VALID_EVENT }),
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body).toEqual({
      ok: false,
      error: "conflicts",
      conflicts: [SAMPLE_CONFLICT],
    });
    // insertEvent must NOT be called when conflicts are detected.
    expect(insertEventMock).not.toHaveBeenCalled();
  });

  it("calls findConflictingEvents with token + calendarId + start/end ISO", async () => {
    authMock.mockResolvedValueOnce({ user: { email: "u@example.com" } });
    getTokenMock.mockResolvedValueOnce("ya29.fake");
    insertEventMock.mockResolvedValueOnce({
      id: "evt_new",
      htmlLink: "https://example.com",
    });
    const POST = await loadInsertRoute();
    await POST(makeInsertRequest({ calendarId: "primary", event: VALID_EVENT }));
    expect(findConflictingEventsMock).toHaveBeenCalledWith(
      "ya29.fake",
      "primary",
      VALID_EVENT.startISO,
      VALID_EVENT.endISO,
    );
  });

  it("skips conflict check and inserts when confirmConflicts is true", async () => {
    authMock.mockResolvedValueOnce({ user: { email: "u@example.com" } });
    getTokenMock.mockResolvedValueOnce("ya29.fake");
    insertEventMock.mockResolvedValueOnce({
      id: "evt_new",
      htmlLink: "https://example.com",
    });
    const POST = await loadInsertRoute();
    const res = await POST(
      makeInsertRequest({
        calendarId: "primary",
        event: VALID_EVENT,
        confirmConflicts: true,
      }),
    );
    expect(res.status).toBe(200);
    expect(findConflictingEventsMock).not.toHaveBeenCalled();
    expect(insertEventMock).toHaveBeenCalledTimes(1);
  });

  it("returns 502 when findConflictingEvents throws", async () => {
    authMock.mockResolvedValueOnce({ user: { email: "u@example.com" } });
    getTokenMock.mockResolvedValueOnce("ya29.fake");
    findConflictingEventsMock.mockRejectedValueOnce(new Error("network down"));
    const POST = await loadInsertRoute();
    const res = await POST(
      makeInsertRequest({ calendarId: "primary", event: VALID_EVENT }),
    );
    expect(res.status).toBe(502);
    expect(insertEventMock).not.toHaveBeenCalled();
  });
});
