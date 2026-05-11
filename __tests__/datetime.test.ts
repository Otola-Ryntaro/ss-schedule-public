import { describe, expect, it } from "vitest";
import { normalizeToEvent } from "@/lib/datetime";
import type { GeminiRawOutput } from "@/lib/schema";

// Reference now: 2026-05-02 10:00:00 JST = 2026-05-02 01:00:00 UTC
const NOW = new Date("2026-05-02T01:00:00.000Z");
const OPTS = { now: NOW, tz: "Asia/Tokyo" as const };

const baseRaw: GeminiRawOutput = {
  title: "歯医者",
  startDate: null,
  startTime: null,
  endDate: null,
  endTime: null,
  isAllDay: false,
  location: null,
  url: null,
  description: null,
  multipleDetected: false,
};

describe("normalizeToEvent", () => {
  it("returns null when startDate is null (Gemini failed to parse)", () => {
    const result = normalizeToEvent(baseRaw, OPTS);
    expect(result).toBeNull();
  });

  it("normalizes a fully-specified time-bounded event", () => {
    const raw: GeminiRawOutput = {
      ...baseRaw,
      startDate: "2026-05-03",
      startTime: "14:00",
      endTime: "15:30",
    };
    const result = normalizeToEvent(raw, OPTS);
    expect(result).not.toBeNull();
    expect(result!.event.startISO).toBe("2026-05-03T14:00:00+09:00");
    expect(result!.event.endISO).toBe("2026-05-03T15:30:00+09:00");
    expect(result!.event.isAllDay).toBe(false);
    expect(result!.pastDateWarning).toBe(false);
  });

  it("defaults endTime to startTime + 1h when endTime is missing", () => {
    const raw: GeminiRawOutput = {
      ...baseRaw,
      startDate: "2026-05-03",
      startTime: "14:00",
    };
    const result = normalizeToEvent(raw, OPTS);
    expect(result!.event.endISO).toBe("2026-05-03T15:00:00+09:00");
    expect(result!.event.isAllDay).toBe(false);
  });

  it("treats date-only input as all-day with end at next day 00:00 JST", () => {
    const raw: GeminiRawOutput = {
      ...baseRaw,
      startDate: "2026-05-03",
      isAllDay: true,
    };
    const result = normalizeToEvent(raw, OPTS);
    expect(result!.event.isAllDay).toBe(true);
    expect(result!.event.startISO).toBe("2026-05-03T00:00:00+09:00");
    expect(result!.event.endISO).toBe("2026-05-04T00:00:00+09:00");
  });

  it("respects multi-day all-day events using endDate", () => {
    const raw: GeminiRawOutput = {
      ...baseRaw,
      startDate: "2026-05-03",
      endDate: "2026-05-05",
      isAllDay: true,
    };
    const result = normalizeToEvent(raw, OPTS);
    expect(result!.event.isAllDay).toBe(true);
    expect(result!.event.startISO).toBe("2026-05-03T00:00:00+09:00");
    // Google end is exclusive: actual last day = 2026-05-05, end = next day 00:00
    expect(result!.event.endISO).toBe("2026-05-06T00:00:00+09:00");
  });

  it("uses endDate (not startDate) when endDate spans into next day for time-bounded events", () => {
    const raw: GeminiRawOutput = {
      ...baseRaw,
      startDate: "2026-05-03",
      startTime: "23:00",
      endDate: "2026-05-04",
      endTime: "01:00",
    };
    const result = normalizeToEvent(raw, OPTS);
    expect(result!.event.startISO).toBe("2026-05-03T23:00:00+09:00");
    expect(result!.event.endISO).toBe("2026-05-04T01:00:00+09:00");
  });

  it("flags pastDateWarning when startISO is before now (no auto-correction)", () => {
    const raw: GeminiRawOutput = {
      ...baseRaw,
      startDate: "2026-05-01",
      startTime: "10:00",
    };
    const result = normalizeToEvent(raw, OPTS);
    expect(result!.event.startISO).toBe("2026-05-01T10:00:00+09:00");
    expect(result!.pastDateWarning).toBe(true);
  });

  it("does not flag pastDateWarning when startISO is exactly now", () => {
    const raw: GeminiRawOutput = {
      ...baseRaw,
      startDate: "2026-05-02",
      startTime: "10:00",
    };
    const result = normalizeToEvent(raw, OPTS);
    expect(result!.pastDateWarning).toBe(false);
  });

  it("does not flag pastDateWarning when startISO is in the future", () => {
    const raw: GeminiRawOutput = {
      ...baseRaw,
      startDate: "2026-05-10",
      startTime: "09:00",
    };
    const result = normalizeToEvent(raw, OPTS);
    expect(result!.pastDateWarning).toBe(false);
  });

  it("preserves location, url, description when present", () => {
    const raw: GeminiRawOutput = {
      ...baseRaw,
      startDate: "2026-05-03",
      startTime: "14:00",
      location: "渋谷",
      url: "https://example.com",
      description: "持ち物: 保険証",
    };
    const result = normalizeToEvent(raw, OPTS);
    expect(result!.event.location).toBe("渋谷");
    expect(result!.event.url).toBe("https://example.com");
    expect(result!.event.description).toBe("持ち物: 保険証");
  });

  it("returns null when url string is non-URL (zod url() validation)", () => {
    const raw: GeminiRawOutput = {
      ...baseRaw,
      startDate: "2026-05-03",
      startTime: "14:00",
      url: "not-a-url",
    };
    const result = normalizeToEvent(raw, OPTS);
    expect(result).toBeNull();
  });

  it("rolls over to next day when +1h crosses midnight", () => {
    const raw: GeminiRawOutput = {
      ...baseRaw,
      startDate: "2026-05-03",
      startTime: "23:30",
    };
    const result = normalizeToEvent(raw, OPTS);
    expect(result!.event.startISO).toBe("2026-05-03T23:30:00+09:00");
    expect(result!.event.endISO).toBe("2026-05-04T00:30:00+09:00");
  });

  it("handles month boundary for all-day events (5/31 -> 6/1)", () => {
    const raw: GeminiRawOutput = {
      ...baseRaw,
      startDate: "2026-05-31",
      isAllDay: true,
    };
    const result = normalizeToEvent(raw, OPTS);
    expect(result!.event.startISO).toBe("2026-05-31T00:00:00+09:00");
    expect(result!.event.endISO).toBe("2026-06-01T00:00:00+09:00");
  });

  it("handles year boundary for all-day events (12/31 -> 1/1)", () => {
    const raw: GeminiRawOutput = {
      ...baseRaw,
      startDate: "2026-12-31",
      isAllDay: true,
    };
    const result = normalizeToEvent(raw, OPTS);
    expect(result!.event.startISO).toBe("2026-12-31T00:00:00+09:00");
    expect(result!.event.endISO).toBe("2027-01-01T00:00:00+09:00");
  });

  it("returns null defensively when startDate violates YYYY-MM-DD (would normally be rejected upstream by GeminiRawOutputSchema)", () => {
    // Bypass type safety to simulate a hypothetical schema bypass.
    const raw = {
      ...baseRaw,
      startDate: "2026/5/3",
      startTime: "14:00",
    } as unknown as GeminiRawOutput;
    const result = normalizeToEvent(raw, OPTS);
    expect(result).toBeNull();
  });
});
