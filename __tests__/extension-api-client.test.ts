import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ConflictError,
  ExtensionApiClient,
  ExtensionApiError,
} from "@/extension/src/lib/api-client";
import type { ExtensionSession } from "@/extension/src/lib/types";
import type { ExtractedEvent } from "@/lib/schema";

const VALID_EVENT: ExtractedEvent = {
  title: "歯医者",
  startISO: "2026-05-03T14:00:00+09:00",
  endISO: "2026-05-03T15:00:00+09:00",
  isAllDay: false,
  location: null,
  url: null,
  description: null,
};

const SAMPLE_CONFLICT = {
  id: "evt_existing",
  title: "既存予定",
  startISO: "2026-05-03T13:30:00+09:00",
  endISO: "2026-05-03T15:30:00+09:00",
  isAllDay: false,
};

const session: ExtensionSession = {
  baseUrl: "https://ss-schedule.vercel.app",
  connectedAt: 1,
  email: "u@example.com",
  expiresAt: null,
  token: "encrypted-session-token",
};

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

describe("ExtensionApiClient", () => {
  it("sends Authorization: Bearer on text extraction", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: false,
          error: "読み取れませんでした",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const api = new ExtensionApiClient(session);
    await api.extractText("明日14時 歯医者");
    const [, init] = fetchMock.mock.calls[0];
    expect((init.headers as Headers).get("Authorization")).toBe(
      "Bearer encrypted-session-token",
    );
  });

  it("maps 401 to reconnect guidance", async () => {
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 401 }));
    const api = new ExtensionApiClient(session);
    await expect(api.listCalendars()).rejects.toMatchObject({
      message: "Webで再接続してください。",
      status: 401,
    } satisfies Partial<ExtensionApiError>);
  });

  it.each([
    [413, "ファイルまたはテキストが大きすぎます。"],
    [429, "リクエストが多すぎます。少し待ってから再試行してください。"],
    [502, "カレンダー側で一時的なエラーが発生しました。"],
  ])("maps status %s to a Japanese error", async (status, message) => {
    fetchMock.mockResolvedValueOnce(new Response("{}", { status }));
    const api = new ExtensionApiClient(session);
    await expect(api.listCalendars()).rejects.toMatchObject({ message, status });
  });

  it("rejects sessions that would send the bearer token to another origin", () => {
    expect(
      () =>
        new ExtensionApiClient({
          ...session,
          baseUrl: "https://evil.example.com",
        }),
    ).toThrow("接続情報を更新してください。");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // ─── SS-014: Conflict detection ───

  it("throws ConflictError with conflicts array on 409 response", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: false,
          error: "conflicts",
          conflicts: [SAMPLE_CONFLICT],
        }),
        { status: 409, headers: { "content-type": "application/json" } },
      ),
    );
    const api = new ExtensionApiClient(session);
    const promise = api.insertEvent("primary", VALID_EVENT);
    await expect(promise).rejects.toBeInstanceOf(ConflictError);
    await expect(promise).rejects.toMatchObject({
      conflicts: [SAMPLE_CONFLICT],
    });
  });

  it("falls back to ExtensionApiError when 409 body is malformed", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: false, error: "conflicts" }), {
        status: 409,
        headers: { "content-type": "application/json" },
      }),
    );
    const api = new ExtensionApiClient(session);
    await expect(api.insertEvent("primary", VALID_EVENT)).rejects.toBeInstanceOf(
      ExtensionApiError,
    );
  });

  it("sends confirmConflicts: false by default in insertEvent body", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ ok: true, id: "evt_new", htmlLink: "https://x" }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const api = new ExtensionApiClient(session);
    await api.insertEvent("primary", VALID_EVENT);
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      calendarId: "primary",
      event: VALID_EVENT,
      confirmConflicts: false,
    });
  });

  it("sends confirmConflicts: true when option is set", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ ok: true, id: "evt_new", htmlLink: "https://x" }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const api = new ExtensionApiClient(session);
    await api.insertEvent("primary", VALID_EVENT, { confirmConflicts: true });
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.confirmConflicts).toBe(true);
  });
});
