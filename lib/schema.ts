// where: lib/schema.ts
// what:  Zod schemas for Gemini raw output, normalized extracted event, and the /api/extract response.
// why:   2-stage typing keeps Gemini responsible only for raw extraction; ISO normalization lives in lib/datetime.ts.
//        Strict YYYY-MM-DD / HH:mm regex is enforced so format violations from Gemini are rejected at the boundary.

import { z } from "zod";

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const TIME_REGEX = /^\d{2}:\d{2}$/;

export const GeminiRawOutputSchema = z.object({
  title: z.string().min(1),
  startDate: z.string().regex(DATE_REGEX).nullable(),
  startTime: z.string().regex(TIME_REGEX).nullable(),
  endDate: z.string().regex(DATE_REGEX).nullable(),
  endTime: z.string().regex(TIME_REGEX).nullable(),
  isAllDay: z.boolean(),
  location: z.string().nullable(),
  url: z.string().nullable(),
  description: z.string().nullable(),
  multipleDetected: z.boolean(),
});

export type GeminiRawOutput = z.infer<typeof GeminiRawOutputSchema>;

// JST is fixed for MVP. We require the literal "+09:00" offset; "Z" / "+00:00" are rejected.
const JSTOffsetISO = z
  .string()
  .datetime({ offset: true })
  .refine((s) => s.endsWith("+09:00"), {
    message: "expected JST offset (+09:00)",
  });

export const ExtractedEventSchema = z.object({
  title: z.string().min(1),
  startISO: JSTOffsetISO,
  endISO: JSTOffsetISO,
  isAllDay: z.boolean(),
  location: z.string().nullable(),
  url: z.string().url().nullable(),
  description: z.string().nullable(),
});

export type ExtractedEvent = z.infer<typeof ExtractedEventSchema>;

export const ExtractResponseSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    event: ExtractedEventSchema,
    multipleDetected: z.boolean(),
    pastDateWarning: z.boolean(),
  }),
  z.object({
    ok: z.literal(false),
    error: z.string(),
  }),
]);

export type ExtractResponse = z.infer<typeof ExtractResponseSchema>;

// SS-010: Client-safe schema for /api/calendar/list response. lib/google-calendar.ts
// pulls in googleapis (server-only); placing the type here lets client components
// import it without dragging the SDK into the browser bundle. See google-calendar.ts
// for the canonical CalendarListEntry shape (this schema mirrors it 1:1).
export const CalendarListEntrySchema = z.object({
  id: z.string(),
  summary: z.string(),
  primary: z.boolean(),
  accessRole: z.enum(["writer", "owner"]),
});
export type CalendarListEntry = z.infer<typeof CalendarListEntrySchema>;

export const CalendarListResponseSchema = z.object({
  calendars: z.array(CalendarListEntrySchema),
});
export type CalendarListResponse = z.infer<typeof CalendarListResponseSchema>;

// Double-booking detection (SS-014). Returned by /api/calendar/insert with HTTP 409
// when an existing event overlaps with the new event's [startISO, endISO) range.
// startISO/endISO are not constrained to JST: events.list may return events in
// other timezones, and we surface them verbatim for display.
export const ConflictEventSchema = z.object({
  id: z.string(),
  title: z.string(),
  startISO: z.string(),
  endISO: z.string(),
  isAllDay: z.boolean(),
});
export type ConflictEvent = z.infer<typeof ConflictEventSchema>;

export const InsertConflictResponseSchema = z.object({
  ok: z.literal(false),
  error: z.literal("conflicts"),
  conflicts: z.array(ConflictEventSchema),
});
export type InsertConflictResponse = z.infer<typeof InsertConflictResponseSchema>;
