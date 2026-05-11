import {
  CalendarListResponseSchema,
  ExtractResponseSchema,
  InsertConflictResponseSchema,
  type CalendarListEntry,
  type ConflictEvent,
  type ExtractResponse,
  type ExtractedEvent,
} from "@/lib/schema";
import { DEFAULT_BASE_URL } from "./constants";
import type { ExtensionSession } from "./types";

export class ExtensionApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ExtensionApiError";
  }
}

// SS-014: thrown by insertEvent() when /api/calendar/insert returns 409 because
// the new event overlaps an existing one. Side-panel UI catches this to show a
// confirmation banner; the user can re-call insertEvent with confirmConflicts: true
// to proceed anyway.
export class ConflictError extends Error {
  constructor(public readonly conflicts: ConflictEvent[]) {
    super("conflicts");
    this.name = "ConflictError";
  }
}

function messageForStatus(status: number): string {
  if (status === 401) return "Webで再接続してください。";
  if (status === 403) return "接続情報を更新してください。";
  if (status === 413) return "ファイルまたはテキストが大きすぎます。";
  if (status === 429) return "リクエストが多すぎます。少し待ってから再試行してください。";
  if (status === 502) return "カレンダー側で一時的なエラーが発生しました。";
  return "通信に失敗しました。";
}

async function parseJson(res: Response): Promise<unknown> {
  return res.json().catch(() => null);
}

function assertAllowedBaseUrl(baseUrl: string): string {
  const allowed = new URL(DEFAULT_BASE_URL).origin;
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new ExtensionApiError("接続情報を更新してください。", 403);
  }
  if (parsed.origin !== allowed) {
    throw new ExtensionApiError("接続情報を更新してください。", 403);
  }
  return parsed.origin;
}

export class ExtensionApiClient {
  private readonly baseUrl: string;

  constructor(private readonly session: ExtensionSession) {
    this.baseUrl = assertAllowedBaseUrl(session.baseUrl);
  }

  private url(path: string): string {
    return `${this.baseUrl}${path}`;
  }

  private authHeaders(extra?: HeadersInit): Headers {
    const headers = new Headers(extra);
    headers.set("Authorization", `Bearer ${this.session.token}`);
    headers.set("Accept", "application/json");
    return headers;
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    const res = await fetch(this.url(path), {
      ...init,
      headers: this.authHeaders(init.headers),
    });
    if (!res.ok) {
      throw new ExtensionApiError(messageForStatus(res.status), res.status);
    }
    return res;
  }

  async extractText(text: string): Promise<ExtractResponse> {
    const res = await this.request("/api/extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    const parsed = ExtractResponseSchema.safeParse(await parseJson(res));
    if (!parsed.success) {
      throw new ExtensionApiError("解析結果の形式が不正です。", 200);
    }
    return parsed.data;
  }

  async extractImage(image: Blob): Promise<ExtractResponse> {
    const form = new FormData();
    form.append("file", image, "selection.png");
    const res = await this.request("/api/extract", {
      method: "POST",
      body: form,
    });
    const parsed = ExtractResponseSchema.safeParse(await parseJson(res));
    if (!parsed.success) {
      throw new ExtensionApiError("解析結果の形式が不正です。", 200);
    }
    return parsed.data;
  }

  async listCalendars(): Promise<CalendarListEntry[]> {
    const res = await this.request("/api/calendar/list", { method: "GET" });
    const parsed = CalendarListResponseSchema.safeParse(await parseJson(res));
    if (!parsed.success) {
      throw new ExtensionApiError("カレンダー一覧の形式が不正です。", 200);
    }
    return parsed.data.calendars;
  }

  async insertEvent(
    calendarId: string,
    event: ExtractedEvent,
    options?: { confirmConflicts?: boolean },
  ): Promise<{ htmlLink: string; id: string }> {
    // Bypasses request() because 409 needs special handling (ConflictError),
    // not the generic ExtensionApiError flow.
    const confirmConflicts = options?.confirmConflicts ?? false;
    const res = await fetch(this.url("/api/calendar/insert"), {
      method: "POST",
      headers: this.authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ calendarId, event, confirmConflicts }),
    });
    if (res.status === 409) {
      const parsed = InsertConflictResponseSchema.safeParse(await parseJson(res));
      if (!parsed.success) {
        throw new ExtensionApiError("登録結果の形式が不正です。", 409);
      }
      throw new ConflictError(parsed.data.conflicts);
    }
    if (!res.ok) {
      throw new ExtensionApiError(messageForStatus(res.status), res.status);
    }
    const json = await parseJson(res);
    if (
      !json ||
      typeof json !== "object" ||
      (json as { ok?: unknown }).ok !== true ||
      typeof (json as { htmlLink?: unknown }).htmlLink !== "string" ||
      typeof (json as { id?: unknown }).id !== "string"
    ) {
      throw new ExtensionApiError("登録結果の形式が不正です。", 200);
    }
    return {
      htmlLink: (json as { htmlLink: string }).htmlLink,
      id: (json as { id: string }).id,
    };
  }
}
