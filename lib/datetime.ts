// where: lib/datetime.ts
// what:  Normalize Gemini raw output (YYYY-MM-DD / HH:mm strict format) into ExtractedEvent
//        with JST-offset ISO strings and Google Calendar-compatible all-day end (exclusive next-day 00:00).
// why:   Gemini owns natural-language interpretation; this layer only handles ISO assembly,
//        end-time defaulting (+1h or next-day 00:00), and past-date warning. No chrono-node-ja.

import { formatInTimeZone } from "date-fns-tz";
import {
  ExtractedEventSchema,
  type ExtractedEvent,
  type GeminiRawOutput,
} from "./schema";

export type NormalizeOpts = { now: Date; tz: "Asia/Tokyo" };

export type NormalizeResult = {
  event: ExtractedEvent;
  pastDateWarning: boolean;
};

export function normalizeToEvent(
  raw: GeminiRawOutput,
  opts: NormalizeOpts,
): NormalizeResult | null {
  if (!raw.startDate) return null;

  const isAllDay = raw.startTime === null;
  let startISO: string;
  let endISO: string;

  if (isAllDay) {
    startISO = `${raw.startDate}T00:00:00+09:00`;
    // Google Calendar end.date is exclusive: pick the last day, then +1 day at 00:00 JST.
    const lastDay = raw.endDate ?? raw.startDate;
    endISO = `${addDaysToYMD(lastDay, 1)}T00:00:00+09:00`;
  } else {
    startISO = `${raw.startDate}T${raw.startTime!}:00+09:00`;
    if (raw.endTime) {
      const endDay = raw.endDate ?? raw.startDate;
      endISO = `${endDay}T${raw.endTime}:00+09:00`;
    } else {
      // +1 hour from startISO, formatted back in JST.
      const startMs = new Date(startISO).getTime();
      if (Number.isNaN(startMs)) return null;
      endISO = formatInTimeZone(
        new Date(startMs + 60 * 60 * 1000),
        opts.tz,
        "yyyy-MM-dd'T'HH:mm:ssXXX",
      );
    }
  }

  const candidate = {
    title: raw.title,
    startISO,
    endISO,
    isAllDay,
    location: raw.location,
    url: raw.url,
    description: raw.description,
  };

  const parsed = ExtractedEventSchema.safeParse(candidate);
  if (!parsed.success) return null;

  const pastDateWarning =
    new Date(parsed.data.startISO).getTime() < opts.now.getTime();

  return { event: parsed.data, pastDateWarning };
}

// Add `days` to a "YYYY-MM-DD" string and return "YYYY-MM-DD". UTC-based to avoid TZ drift.
function addDaysToYMD(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  const yy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}
