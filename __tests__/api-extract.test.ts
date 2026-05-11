// where: __tests__/api-extract.test.ts
// what:  Tests for POST /api/extract — auth, CSRF, MIME, size, rate limit, success paths.
// why:   The route directly invokes lib/gemini and lib/datetime. We mock @/auth and the
//        gemini extractors so tests are hermetic and deterministic. Rate limit state lives
//        inside the route module, so we use vi.resetModules() between tests that exercise it.
//
// @vitest-environment node
// (jsdom's Blob/FormData implementations corrupt binary data when serialized through
//  NextRequest's undici-backed body, so this suite runs in node env where the global
//  Blob/FormData are undici's, matching the runtime.)

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// ───────────────────────────────────────────────
// Mocks (must be set up before importing the route)
// ───────────────────────────────────────────────

const authMock = vi.fn();
const extractFromImageMock = vi.fn();
const extractFromTextMock = vi.fn();

vi.mock("@/auth", () => ({
  auth: () => authMock(),
}));

vi.mock("@/lib/gemini", () => ({
  extractFromImage: (...args: unknown[]) => extractFromImageMock(...args),
  extractFromText: (...args: unknown[]) => extractFromTextMock(...args),
}));

const VALID_RAW = {
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

// 1×1 transparent PNG (magic bytes valid). image-size returns width/height = 1.
const PNG_MAGIC_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP8//8/AwAI/AL+pK7c8gAAAABJRU5ErkJggg==",
  "base64",
);

const ORIGINAL_AUTH_URL = process.env.AUTH_URL;

beforeEach(() => {
  process.env.AUTH_URL = "https://app.example.com";
  authMock.mockReset();
  extractFromImageMock.mockReset();
  extractFromTextMock.mockReset();
});

afterEach(() => {
  if (ORIGINAL_AUTH_URL === undefined) delete process.env.AUTH_URL;
  else process.env.AUTH_URL = ORIGINAL_AUTH_URL;
  vi.resetModules();
});

// ───────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────

async function loadRoute() {
  // Fresh module per import so the in-memory rate-limit Map is reset between tests.
  const mod = await import("@/app/api/extract/route");
  return mod.POST as (req: NextRequest) => Promise<Response>;
}

function makeJsonRequest(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest("https://app.example.com/api/extract", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://app.example.com",
      "sec-fetch-site": "same-origin",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function makeMultipartRequest(
  fileBuf: Buffer,
  fileType: string,
  headers: Record<string, string> = {},
): NextRequest {
  const fd = new FormData();
  const u8 = new Uint8Array(fileBuf);
  fd.append("file", new Blob([u8], { type: fileType }), "screenshot.png");
  return new NextRequest("https://app.example.com/api/extract", {
    method: "POST",
    headers: {
      origin: "https://app.example.com",
      "sec-fetch-site": "same-origin",
      ...headers,
    },
    body: fd,
  });
}

// ───────────────────────────────────────────────
// Tests
// ───────────────────────────────────────────────

describe("POST /api/extract — auth & CSRF", () => {
  it("returns 401 when unauthenticated", async () => {
    authMock.mockResolvedValueOnce(null);
    const POST = await loadRoute();
    const res = await POST(makeJsonRequest({ text: "明日 14:00 歯医者" }));
    expect(res.status).toBe(401);
  });

  it("returns 403 when Origin host does not match (cross-origin)", async () => {
    authMock.mockResolvedValueOnce({ user: { email: "u@example.com" } });
    const POST = await loadRoute();
    const res = await POST(
      makeJsonRequest(
        { text: "明日 14:00 歯医者" },
        { origin: "https://evil.example.com" },
      ),
    );
    expect(res.status).toBe(403);
  });

  it("returns 403 when both Origin and Sec-Fetch-Site are absent", async () => {
    authMock.mockResolvedValueOnce({ user: { email: "u@example.com" } });
    const POST = await loadRoute();
    const req = new NextRequest("https://app.example.com/api/extract", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "x" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
  });
});

describe("POST /api/extract — JSON text input", () => {
  beforeEach(() => {
    authMock.mockResolvedValue({ user: { email: "u@example.com" } });
  });

  it("returns 200 + event when extraction succeeds", async () => {
    extractFromTextMock.mockResolvedValueOnce(VALID_RAW);
    const POST = await loadRoute();
    const res = await POST(makeJsonRequest({ text: "明日 14:00 歯医者 渋谷" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.event.title).toBe("歯医者");
    expect(body.event.startISO).toBe("2026-05-03T14:00:00+09:00");
    expect(body.multipleDetected).toBe(false);
  });

  it("returns 400 when text field is missing", async () => {
    const POST = await loadRoute();
    const res = await POST(makeJsonRequest({}));
    expect(res.status).toBe(400);
  });

  it("returns 400 when text is empty string", async () => {
    const POST = await loadRoute();
    const res = await POST(makeJsonRequest({ text: "" }));
    expect(res.status).toBe(400);
  });

  it("returns 413 when text exceeds 4000 chars", async () => {
    const POST = await loadRoute();
    const longText = "あ".repeat(4001);
    const res = await POST(makeJsonRequest({ text: longText }));
    expect(res.status).toBe(413);
  });

  it("returns 200 with ok:false friendly error when Gemini returns null", async () => {
    extractFromTextMock.mockResolvedValueOnce(null);
    const POST = await loadRoute();
    const res = await POST(makeJsonRequest({ text: "意味不明テキスト" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toContain("読み取れませんでした");
  });

  it("returns 200 with ok:false when Gemini throws", async () => {
    extractFromTextMock.mockRejectedValueOnce(new Error("Gemini API call failed: boom"));
    const POST = await loadRoute();
    const res = await POST(makeJsonRequest({ text: "明日 14:00 歯医者" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(false);
  });

  it("returns 200 with ok:false when normalize returns null (no startDate)", async () => {
    extractFromTextMock.mockResolvedValueOnce({ ...VALID_RAW, startDate: null });
    const POST = await loadRoute();
    const res = await POST(makeJsonRequest({ text: "x" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(false);
  });
});

describe("POST /api/extract — multipart image input", () => {
  beforeEach(() => {
    authMock.mockResolvedValue({ user: { email: "u@example.com" } });
  });

  it("returns 200 + event when PNG image extraction succeeds", async () => {
    extractFromImageMock.mockResolvedValueOnce(VALID_RAW);
    const POST = await loadRoute();
    const res = await POST(makeMultipartRequest(PNG_MAGIC_1X1, "image/png"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.event.title).toBe("歯医者");
  });

  it("returns 400 when MIME type is not image", async () => {
    const POST = await loadRoute();
    const fakePdf = Buffer.from("%PDF-1.4 fake content");
    const res = await POST(makeMultipartRequest(fakePdf, "application/pdf"));
    expect(res.status).toBe(400);
  });

  it("returns 400 when MIME claim and magic bytes disagree (spoofing)", async () => {
    const POST = await loadRoute();
    // Send a non-image payload but claim image/png — magic bytes check must reject.
    const fake = Buffer.from("not actually a PNG");
    const res = await POST(makeMultipartRequest(fake, "image/png"));
    expect(res.status).toBe(400);
  });

  it("returns 413 when image exceeds 5MB", async () => {
    const POST = await loadRoute();
    // 5MB + 1 byte. Use the valid PNG header so we fail on size, not MIME.
    const head = PNG_MAGIC_1X1;
    const padding = Buffer.alloc(5 * 1024 * 1024 + 1 - head.length, 0);
    const big = Buffer.concat([head, padding]);
    const res = await POST(makeMultipartRequest(big, "image/png"));
    expect(res.status).toBe(413);
  });

  it("returns 400 when multipart body has no file field", async () => {
    const POST = await loadRoute();
    const fd = new FormData();
    fd.append("notfile", "x");
    const req = new NextRequest("https://app.example.com/api/extract", {
      method: "POST",
      headers: {
        origin: "https://app.example.com",
        "sec-fetch-site": "same-origin",
      },
      body: fd,
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 when image-size returns undefined dimensions", async () => {
    // Defensive guard: image-size@2 may return undefined width/height for some
    // malformed inputs. Mock it to simulate this and verify we reject with 400
    // rather than silently skipping the dimension check.
    vi.resetModules();
    vi.doMock("image-size", () => ({
      imageSize: () => ({ width: undefined, height: undefined }),
    }));
    const mod = await import("@/app/api/extract/route");
    const POST = mod.POST as (req: NextRequest) => Promise<Response>;
    const res = await POST(makeMultipartRequest(PNG_MAGIC_1X1, "image/png"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("could not read image dimensions");
    vi.doUnmock("image-size");
  });
});

describe("POST /api/extract — rate limit", () => {
  beforeEach(() => {
    authMock.mockResolvedValue({ user: { email: "rate@example.com" } });
    extractFromTextMock.mockResolvedValue(VALID_RAW);
  });

  it("returns 429 after 10 requests in 60 seconds for same user", async () => {
    const POST = await loadRoute();
    for (let i = 0; i < 10; i++) {
      const res = await POST(makeJsonRequest({ text: `req ${i}` }));
      expect(res.status).toBe(200);
    }
    const res11 = await POST(makeJsonRequest({ text: "req 11" }));
    expect(res11.status).toBe(429);
  });
});
