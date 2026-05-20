// where: app/api/auth/status/route.ts
// what:  GET /api/auth/status — probes whether the user's Google connection is still
//        usable, for the header "接続を確認" button.
// why:   Auth.js keeps the session cookie alive for ~30 days, but the Google refresh
//        token can die sooner (notably every 7 days while the OAuth app is in "Testing"
//        publishing status). When that happens the UI silently 401s with no recovery
//        path. This route makes one real, lightweight Calendar API call and always
//        answers 200 with an { ok } discriminator so the client can render a state
//        without status-code branching. Failure reasons:
//          - unauthenticated : no Auth.js session at all
//          - token_expired   : refresh token is dead / access token unrecoverable
//          - calendar_error  : token retrieved but the Google API call failed

import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/api-guards";
import { getCalendarAccessToken } from "@/lib/auth-token";
import { listCalendars } from "@/lib/google-calendar";

const NO_STORE = { "Cache-Control": "private, no-store" } as const;

function result(
  body: { ok: true } | { ok: false; reason: string },
): Response {
  return NextResponse.json(body, { status: 200, headers: NO_STORE });
}

export async function GET(req: NextRequest): Promise<Response> {
  const authResult = await requireAuth(req);
  if (authResult instanceof Response) {
    // No session cookie — the user must sign in again from scratch.
    return result({ ok: false, reason: "unauthenticated" });
  }

  let token: string;
  try {
    token = await getCalendarAccessToken(req);
  } catch (err) {
    console.error("[/api/auth/status] token error", err);
    return result({ ok: false, reason: "token_expired" });
  }

  // One real call confirms the token is actually accepted by Google right now.
  try {
    await listCalendars(token);
  } catch (err) {
    console.error("[/api/auth/status] calendar error", err);
    return result({ ok: false, reason: "calendar_error" });
  }

  return result({ ok: true });
}
