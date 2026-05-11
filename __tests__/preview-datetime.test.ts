// where: __tests__/preview-datetime.test.ts
// what:  Unit tests for the new quick-adjust helpers added for M3 (日時クイック補正).
// why:   datetime-local string math is fiddly (cross-day, leap day, all-day vs timed),
//        so the chips on PreviewForm must trust pure helpers verified here.

import { describe, it, expect } from "vitest";
import {
  addMinutesLocal,
  addDaysToLocal,
} from "@/lib/preview-datetime";

describe("addMinutesLocal", () => {
  it("adds positive minutes within the same hour", () => {
    expect(addMinutesLocal("2026-05-08T14:00", 15)).toBe("2026-05-08T14:15");
  });

  it("rolls over hour boundary", () => {
    expect(addMinutesLocal("2026-05-08T14:50", 15)).toBe("2026-05-08T15:05");
  });

  it("rolls over the day boundary at midnight", () => {
    expect(addMinutesLocal("2026-05-08T23:50", 30)).toBe("2026-05-09T00:20");
  });

  it("supports negative deltas", () => {
    expect(addMinutesLocal("2026-05-08T00:10", -30)).toBe("2026-05-07T23:40");
  });

  it("returns input verbatim if it does not match the expected pattern", () => {
    // All-day YYYY-MM-DD does not have a time, so the chip must not corrupt it.
    expect(addMinutesLocal("2026-05-08", 15)).toBe("2026-05-08");
  });
});

describe("addDaysToLocal", () => {
  it("adds days to a YYYY-MM-DD value", () => {
    expect(addDaysToLocal("2026-05-08", 1)).toBe("2026-05-09");
  });

  it("adds days to a YYYY-MM-DDTHH:mm value while preserving the time", () => {
    expect(addDaysToLocal("2026-05-08T14:00", 7)).toBe("2026-05-15T14:00");
  });

  it("crosses the month boundary", () => {
    expect(addDaysToLocal("2026-05-31T09:00", 1)).toBe("2026-06-01T09:00");
  });

  it("supports negative deltas", () => {
    expect(addDaysToLocal("2026-05-01T09:00", -1)).toBe("2026-04-30T09:00");
  });

  it("returns input verbatim for malformed strings", () => {
    expect(addDaysToLocal("not-a-date", 1)).toBe("not-a-date");
  });
});
