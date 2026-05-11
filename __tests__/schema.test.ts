import { describe, expect, it } from "vitest";
import {
  ExtractResponseSchema,
  ExtractedEventSchema,
  GeminiRawOutputSchema,
} from "@/lib/schema";

describe("GeminiRawOutputSchema", () => {
  const valid = {
    title: "歯医者",
    startDate: "2026-05-03",
    startTime: "14:00",
    endDate: null,
    endTime: null,
    isAllDay: false,
    location: "渋谷",
    url: null,
    description: null,
    multipleDetected: false,
  };

  it("accepts a fully populated valid raw output", () => {
    const result = GeminiRawOutputSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it("accepts nulls for all date/time/location/url/description fields", () => {
    const result = GeminiRawOutputSchema.safeParse({
      ...valid,
      startDate: null,
      startTime: null,
      endDate: null,
      endTime: null,
      location: null,
      url: null,
      description: null,
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty title", () => {
    const result = GeminiRawOutputSchema.safeParse({ ...valid, title: "" });
    expect(result.success).toBe(false);
  });

  it("requires multipleDetected to be a boolean", () => {
    const result = GeminiRawOutputSchema.safeParse({
      ...valid,
      multipleDetected: "false",
    });
    expect(result.success).toBe(false);
  });

  it("rejects startDate in slash format (Gemini must return YYYY-MM-DD)", () => {
    const result = GeminiRawOutputSchema.safeParse({
      ...valid,
      startDate: "2026/5/3",
    });
    expect(result.success).toBe(false);
  });

  it("rejects startDate in Japanese format", () => {
    const result = GeminiRawOutputSchema.safeParse({
      ...valid,
      startDate: "2026年5月3日",
    });
    expect(result.success).toBe(false);
  });

  it("rejects startTime in 12-hour Japanese format", () => {
    const result = GeminiRawOutputSchema.safeParse({
      ...valid,
      startTime: "午後3時",
    });
    expect(result.success).toBe(false);
  });

  it("rejects startTime without leading zero", () => {
    const result = GeminiRawOutputSchema.safeParse({
      ...valid,
      startTime: "9:00",
    });
    expect(result.success).toBe(false);
  });
});

describe("ExtractedEventSchema", () => {
  const valid = {
    title: "歯医者",
    startISO: "2026-05-03T14:00:00+09:00",
    endISO: "2026-05-03T15:00:00+09:00",
    isAllDay: false,
    location: "渋谷",
    url: "https://example.com",
    description: null,
  };

  it("accepts a valid extracted event", () => {
    const result = ExtractedEventSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it("requires title to be non-empty", () => {
    const result = ExtractedEventSchema.safeParse({ ...valid, title: "" });
    expect(result.success).toBe(false);
  });

  it("rejects startISO without offset (must be JST offset)", () => {
    const result = ExtractedEventSchema.safeParse({
      ...valid,
      startISO: "2026-05-03T14:00:00",
    });
    expect(result.success).toBe(false);
  });

  it("rejects startISO with Z (UTC) offset (JST is required)", () => {
    const result = ExtractedEventSchema.safeParse({
      ...valid,
      startISO: "2026-05-03T14:00:00Z",
    });
    expect(result.success).toBe(false);
  });

  it("rejects startISO with +00:00 offset (JST is required)", () => {
    const result = ExtractedEventSchema.safeParse({
      ...valid,
      startISO: "2026-05-03T14:00:00+00:00",
    });
    expect(result.success).toBe(false);
  });

  it("rejects endISO with non-JST offset", () => {
    const result = ExtractedEventSchema.safeParse({
      ...valid,
      endISO: "2026-05-03T15:00:00+05:30",
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-URL string in url field", () => {
    const result = ExtractedEventSchema.safeParse({
      ...valid,
      url: "not-a-url",
    });
    expect(result.success).toBe(false);
  });

  it("accepts null for url", () => {
    const result = ExtractedEventSchema.safeParse({ ...valid, url: null });
    expect(result.success).toBe(true);
  });

  it("requires isAllDay to be a boolean", () => {
    const result = ExtractedEventSchema.safeParse({
      ...valid,
      isAllDay: "false",
    });
    expect(result.success).toBe(false);
  });
});

describe("ExtractResponseSchema (discriminated union)", () => {
  const event = {
    title: "歯医者",
    startISO: "2026-05-03T14:00:00+09:00",
    endISO: "2026-05-03T15:00:00+09:00",
    isAllDay: false,
    location: null,
    url: null,
    description: null,
  };

  it("accepts ok: true with event, multipleDetected, pastDateWarning", () => {
    const result = ExtractResponseSchema.safeParse({
      ok: true,
      event,
      multipleDetected: false,
      pastDateWarning: false,
    });
    expect(result.success).toBe(true);
  });

  it("accepts ok: true with pastDateWarning: true", () => {
    const result = ExtractResponseSchema.safeParse({
      ok: true,
      event,
      multipleDetected: false,
      pastDateWarning: true,
    });
    expect(result.success).toBe(true);
  });

  it("accepts ok: false with error message", () => {
    const result = ExtractResponseSchema.safeParse({
      ok: false,
      error: "読み取れませんでした",
    });
    expect(result.success).toBe(true);
  });

  it("rejects ok: true without event", () => {
    const result = ExtractResponseSchema.safeParse({
      ok: true,
      multipleDetected: false,
      pastDateWarning: false,
    });
    expect(result.success).toBe(false);
  });

  it("rejects ok: false without error", () => {
    const result = ExtractResponseSchema.safeParse({ ok: false });
    expect(result.success).toBe(false);
  });
});
