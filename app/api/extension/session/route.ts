// where: app/api/extension/session/route.ts
// what:  Returns the current raw Auth.js JWT session token for the Chrome extension bridge.
// why:   The extension cannot rely on SameSite cookies from chrome-extension:// pages.
//        A logged-in Web page sends this encrypted token to the extension, and the
//        extension uses it as Authorization: Bearer for existing API routes.

import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { getRawSessionToken } from "@/lib/auth-token";

export async function GET(req: NextRequest): Promise<Response> {
  const session = await auth();
  const email = session?.user?.email ?? null;
  if (!email) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  }

  const raw = await getRawSessionToken(req);
  if (!raw || raw.email !== email) {
    return NextResponse.json(
      { ok: false, error: "session token unavailable" },
      { status: 401 },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      email,
      expiresAt: raw.expiresAt,
      token: raw.token,
    },
    { status: 200, headers: { "Cache-Control": "private, no-store" } },
  );
}
