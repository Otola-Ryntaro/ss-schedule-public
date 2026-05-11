// where: app/api/calendar/insert/route.ts
// what:  POST /api/calendar/insert — inserts a confirmed event into the chosen Google calendar.
// why:   Independent POST API (no Auth.js CSRF coverage), so we run requireSameOrigin first.
//        Client-edited payloads are re-validated server-side with ExtractedEventSchema; only
//        validated values reach lib/google-calendar.insertEvent. SDK / network failures map
//        to 502 with a generic message — error details stay in server logs (ticket spec).

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, requireRateLimit, requireSameOrigin } from "@/lib/api-guards";
import { getCalendarAccessToken } from "@/lib/auth-token";
import { findConflictingEvents, insertEvent } from "@/lib/google-calendar";
import { ExtractedEventSchema } from "@/lib/schema";

const InsertBodySchema = z.object({
  calendarId: z.string().min(1),
  event: ExtractedEventSchema,
  // SS-014: when false (default), the server checks for double-bookings and
  // returns 409 if any are found. The client re-submits with true after the
  // user confirms the override.
  confirmConflicts: z.boolean().optional().default(false),
});

export async function POST(req: NextRequest): Promise<Response> {
  // 1. Auth. Chrome extension calls use Authorization: Bearer and do not carry
  // a same-origin Web Origin, so only cookie-backed calls go through CSRF below.
  const authResult = await requireAuth(req);
  if (authResult instanceof Response) return authResult;

  // 2. CSRF for cookie-backed Web calls.
  if (authResult.mode === "cookie") {
    const originResult = requireSameOrigin(req);
    if (originResult) return originResult;
  }

  // 3. Rate limit (per-email) before the side-effecting Calendar write path.
  const rateResult = requireRateLimit(authResult.email);
  if (rateResult) return rateResult;

  // 4. Body parse + zod re-validation (client edits cannot be trusted).
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid json body" },
      { status: 400 },
    );
  }
  const parsed = InsertBodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "invalid payload" },
      { status: 400 },
    );
  }

  // 5. Token (after validation so we don't burn a getToken() call on bad input).
  let token: string;
  try {
    token = await getCalendarAccessToken(req);
  } catch (err) {
    console.error("[/api/calendar/insert] token error", err);
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  }

  // 6. Conflict detection (SS-014). Skipped when the client has already shown
  // the user the conflict list and they chose to proceed.
  if (!parsed.data.confirmConflicts) {
    try {
      const conflicts = await findConflictingEvents(
        token,
        parsed.data.calendarId,
        parsed.data.event.startISO,
        parsed.data.event.endISO,
      );
      if (conflicts.length > 0) {
        return NextResponse.json(
          { ok: false, error: "conflicts", conflicts },
          { status: 409 },
        );
      }
    } catch (err) {
      console.error("[/api/calendar/insert] conflict-check error", err);
      return NextResponse.json(
        { ok: false, error: "calendar service error" },
        { status: 502 },
      );
    }
  }

  // 7. SDK call.
  try {
    const { id, htmlLink } = await insertEvent(
      token,
      parsed.data.calendarId,
      parsed.data.event,
    );
    return NextResponse.json({ ok: true, id, htmlLink }, { status: 200 });
  } catch (err) {
    console.error("[/api/calendar/insert] sdk error", err);
    return NextResponse.json(
      { ok: false, error: "calendar service error" },
      { status: 502 },
    );
  }
}
