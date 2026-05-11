// where: lib/preview-datetime.ts
// what:  Pure helpers for converting between JST-offset ISO strings (the schema's
//        on-the-wire format) and the values <input type="datetime-local"> /
//        <input type="date"> consume (no offset, local string).
// why:   JST is fixed for MVP, so we can do this with simple slicing instead of
//        pulling date-fns-tz into the client bundle. Centralising the logic keeps
//        the preview page focused on UI state.

// All ExtractedEvent ISOs are guaranteed to end with "+09:00" (see lib/schema.ts
// JSTOffsetISO). For datetime-local we want "YYYY-MM-DDTHH:mm" (16 chars); for
// all-day we want the YYYY-MM-DD prefix (10 chars).

export function nowJSTLocal(): string {
  // Compute "now" in JST by shifting UTC by +9h then formatting via UTC getters.
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return formatJSTParts(d).slice(0, 16);
}

export function isoToDatetimeLocal(iso: string): string {
  // Slicing is safe because the schema enforces "+09:00" suffix.
  return iso.slice(0, 16);
}

export function isoToDate(iso: string): string {
  return iso.slice(0, 10);
}

export function addOneHourLocal(ymdHm: string): string {
  return addMinutesLocal(ymdHm, 60);
}

// Add `minutes` (may be negative) to a YYYY-MM-DDTHH:mm datetime-local string.
// Used by the M3 quick-adjust chips ("+15分" など). For all-day YYYY-MM-DD inputs
// the value is returned unchanged so the chip wiring can be wholesale identical.
export function addMinutesLocal(ymdHm: string, minutes: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(ymdHm);
  if (!m) return ymdHm;
  const [, y, mo, d, h, mi] = m;
  const next = new Date(
    Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi)) +
      minutes * 60 * 1000,
  );
  return formatJSTParts(next).slice(0, 16);
}

export function addDaysToYMD(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  const yy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

// Add `days` to either a YYYY-MM-DD (all-day) or YYYY-MM-DDTHH:mm value while
// preserving the time portion. Used by the M3 quick-adjust chips ("翌日" / "来週同曜日").
export function addDaysToLocal(value: string, days: number): string {
  const ymdMatch = /^(\d{4}-\d{2}-\d{2})(T\d{2}:\d{2})?$/.exec(value);
  if (!ymdMatch) return value;
  const [, ymd, time] = ymdMatch;
  const shifted = addDaysToYMD(ymd, days);
  // addDaysToYMD echoes its input on parse failure; if that happened, also bail.
  if (shifted === ymd && days !== 0) {
    // Fall through — addDaysToYMD only echoes on malformed YMD which we already rejected.
  }
  return time ? `${shifted}${time}` : shifted;
}

export function localToJSTISO(value: string, isAllDay: boolean): string {
  if (isAllDay) {
    // Inclusive YYYY-MM-DD -> JST midnight ISO.
    return `${value}T00:00:00+09:00`;
  }
  // datetime-local YYYY-MM-DDTHH:mm -> add seconds + offset.
  return `${value}:00+09:00`;
}

// Format a Date's UTC fields as "YYYY-MM-DDTHH:mm:ss" (no offset). The caller is
// responsible for having already shifted into JST.
function formatJSTParts(d: Date): string {
  const yy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mi = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = String(d.getUTCSeconds()).padStart(2, "0");
  return `${yy}-${mm}-${dd}T${hh}:${mi}:${ss}`;
}
