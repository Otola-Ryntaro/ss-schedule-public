// where: app/api/extract/route.ts
// what:  POST /api/extract — accepts an image (multipart/form-data, key "file") or text
//        (application/json, { text }), extracts a single event via Gemini, normalizes it
//        to a JST-offset ISO event, and returns ExtractResponse.
// why:   CSRF, auth, and rate-limit are delegated to lib/api-guards (shared with
//        /api/calendar/*). MIME / size / dimension / length checks stay here because
//        they are extract-specific. Gemini / normalize failures are surfaced as ok:false
//        with a friendly Japanese message at HTTP 200 (per ticket spec). Real errors land
//        in server logs only, never in the client response, so the API key & SDK details
//        are never leaked.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { fileTypeFromBuffer } from "file-type";
import { imageSize } from "image-size";
import { requireAuth, requireRateLimit, requireSameOrigin } from "@/lib/api-guards";
import { extractFromImage, extractFromText } from "@/lib/gemini";
import { normalizeToEvent } from "@/lib/datetime";
import { ExtractedEventSchema } from "@/lib/schema";

// ───────────────────────────────────────────────
// Constants
// ───────────────────────────────────────────────

const ALLOWED_MIME = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_IMAGE_DIM = 8000; // px
const MAX_TEXT_LEN = 4000;

const FRIENDLY_ERROR =
  "読み取れませんでした、もう一度試すか手動で登録してください";

const TextBodySchema = z.object({
  text: z.string().min(1).max(MAX_TEXT_LEN),
});

// ───────────────────────────────────────────────
// Route handler
// ───────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<Response> {
  // 1. Auth. Chrome extension calls use Authorization: Bearer and do not have a
  // same-origin browser Origin, so we authenticate first and only run CSRF for
  // the existing cookie-backed Web flow.
  const authResult = await requireAuth(req);
  if (authResult instanceof Response) return authResult;

  // 2. CSRF for cookie-backed Web calls. Bearer calls are explicit API-token calls.
  if (authResult.mode === "cookie") {
    const originResult = requireSameOrigin(req);
    if (originResult) return originResult;
  }

  // 3. Rate limit (per-email).
  const rateResult = requireRateLimit(authResult.email);
  if (rateResult) return rateResult;

  const now = new Date();
  const contentType = req.headers.get("content-type") ?? "";

  try {
    if (contentType.startsWith("multipart/form-data")) {
      return await handleImage(req, now);
    }
    if (contentType.startsWith("application/json")) {
      return await handleText(req, now);
    }
    return jsonError(400, "unsupported content-type");
  } catch (err) {
    // Anything that escapes the per-handler error funnel — log only, return friendly 200.
    console.error("[/api/extract] unexpected error", err);
    return NextResponse.json({ ok: false, error: FRIENDLY_ERROR }, { status: 200 });
  }
}

// ───────────────────────────────────────────────
// Image branch
// ───────────────────────────────────────────────

async function handleImage(req: NextRequest, now: Date): Promise<Response> {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return jsonError(400, "invalid form data");
  }

  const file = form.get("file");
  // Duck-typed check: undici File / web Blob both satisfy this. instanceof Blob can fail
  // across realms (e.g. jsdom global Blob vs undici File in tests).
  if (
    !file ||
    typeof file !== "object" ||
    typeof (file as Blob).arrayBuffer !== "function" ||
    typeof (file as Blob).size !== "number" ||
    typeof (file as Blob).type !== "string"
  ) {
    return jsonError(400, "missing file field");
  }
  const blob = file as Blob;

  if (blob.size > MAX_IMAGE_BYTES) {
    return jsonError(413, "file too large");
  }

  const claimedMime = blob.type;
  if (!ALLOWED_MIME.has(claimedMime)) {
    return jsonError(400, "unsupported mime type");
  }

  const arrayBuf = await blob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuf);

  // Re-check size after read (paranoia: trust nothing from the request).
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    return jsonError(413, "file too large");
  }

  const detected = await fileTypeFromBuffer(bytes);
  if (!detected || !ALLOWED_MIME.has(detected.mime) || detected.mime !== claimedMime) {
    return jsonError(400, "mime type mismatch");
  }

  let dim: { width: number; height: number };
  try {
    const sized = imageSize(bytes);
    if (typeof sized.width !== "number" || typeof sized.height !== "number") {
      return jsonError(400, "could not read image dimensions");
    }
    dim = { width: sized.width, height: sized.height };
  } catch {
    return jsonError(400, "could not read image dimensions");
  }
  if (dim.width > MAX_IMAGE_DIM || dim.height > MAX_IMAGE_DIM) {
    return jsonError(400, "image dimensions too large");
  }

  const base64 = Buffer.from(bytes).toString("base64");

  let raw;
  try {
    raw = await extractFromImage(base64, claimedMime, now);
  } catch (err) {
    console.error("[/api/extract] gemini image error", err);
    return friendlyFail();
  }
  return finalizeOrFail(raw, now);
}

// ───────────────────────────────────────────────
// Text branch
// ───────────────────────────────────────────────

async function handleText(req: NextRequest, now: Date): Promise<Response> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return jsonError(400, "invalid json body");
  }

  // Overlength gets a dedicated 413, matching the image branch and ticket spec.
  // Empty/missing text continues to fall through the zod check as 400.
  if (
    typeof (json as { text?: unknown })?.text === "string" &&
    (json as { text: string }).text.length > MAX_TEXT_LEN
  ) {
    return jsonError(413, "text too long");
  }

  const parsed = TextBodySchema.safeParse(json);
  if (!parsed.success) {
    return jsonError(400, "invalid text payload");
  }

  let raw;
  try {
    raw = await extractFromText(parsed.data.text, now);
  } catch (err) {
    console.error("[/api/extract] gemini text error", err);
    return friendlyFail();
  }
  return finalizeOrFail(raw, now);
}

// ───────────────────────────────────────────────
// Shared finalizer
// ───────────────────────────────────────────────

function finalizeOrFail(
  raw: Awaited<ReturnType<typeof extractFromText>>,
  now: Date,
): Response {
  if (raw === null) {
    return friendlyFail();
  }
  const normalized = normalizeToEvent(raw, { now, tz: "Asia/Tokyo" });
  if (normalized === null) {
    return friendlyFail();
  }
  const validated = ExtractedEventSchema.safeParse(normalized.event);
  if (!validated.success) {
    console.error("[/api/extract] schema validation failed", validated.error);
    return friendlyFail();
  }
  return NextResponse.json(
    {
      ok: true,
      event: validated.data,
      multipleDetected: raw.multipleDetected,
      pastDateWarning: normalized.pastDateWarning,
    },
    { status: 200 },
  );
}

// ───────────────────────────────────────────────
// Tiny helpers
// ───────────────────────────────────────────────

function jsonError(status: number, error: string): Response {
  return NextResponse.json({ ok: false, error }, { status });
}

function friendlyFail(): Response {
  return NextResponse.json(
    { ok: false, error: FRIENDLY_ERROR },
    { status: 200 },
  );
}
