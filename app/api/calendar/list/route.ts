// where: app/api/calendar/list/route.ts
// what:  GET /api/calendar/list — returns the user's writable / owned Google calendars
//        for the preview screen's "write to which calendar" picker.
// why:   Auth-required, user-specific. Cache-Control: private, no-store prevents any
//        intermediary or browser disk cache from leaking another user's calendar list.
//        SDK errors are mapped to 502 (per ticket: surface only generic message; details
//        go to server logs). 401 is returned for both unauthenticated and stale-token cases
//        so the client can route the user back through sign-in.

import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/api-guards";
import { getCalendarAccessToken } from "@/lib/auth-token";
import { listCalendars } from "@/lib/google-calendar";

export async function GET(req: NextRequest): Promise<Response> {
  const authResult = await requireAuth(req);
  if (authResult instanceof Response) return authResult;

  let token: string;
  try {
    token = await getCalendarAccessToken(req);
  } catch (err) {
    console.error("[/api/calendar/list] token error", err);
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  }

  let calendars;
  try {
    calendars = await listCalendars(token);
  } catch (err) {
    console.error("[/api/calendar/list] sdk error", err);
    return NextResponse.json(
      { ok: false, error: "calendar service error" },
      { status: 502 },
    );
  }

  return NextResponse.json(
    { calendars },
    {
      status: 200,
      headers: { "Cache-Control": "private, no-store" },
    },
  );
}
