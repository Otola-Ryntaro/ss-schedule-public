// where: __tests__/preview.test.tsx
// what:  React Testing Library tests for the preview/edit form (SS-010).
// why:   The page covers two entry modes (sessionStorage hydration vs ?manual=1) and
//        a single submit funnel; these tests pin down the externally observable
//        behaviour: initial values, manual blank form, validation gate, multipleDetected
//        banner, and the POST payload to /api/calendar/insert.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import PreviewPage from "@/app/preview/page";
import { EXTRACT_STORAGE_KEY } from "@/lib/storage-keys";

const navigateMock = vi.fn();
const searchParamsMock = { get: vi.fn() };

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: navigateMock,
    replace: navigateMock,
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
  useSearchParams: () => searchParamsMock,
}));

const successExtract = {
  ok: true,
  event: {
    title: "ミーティング",
    startISO: "2026-05-10T10:00:00+09:00",
    endISO: "2026-05-10T11:00:00+09:00",
    isAllDay: false,
    location: "渋谷",
    url: null,
    description: null,
  },
  multipleDetected: false,
  pastDateWarning: false,
};

const calendarListResponse = {
  calendars: [
    {
      id: "primary",
      summary: "メイン",
      primary: true,
      accessRole: "owner",
    },
    {
      id: "work@example.com",
      summary: "仕事",
      primary: false,
      accessRole: "writer",
    },
  ],
};

function mockFetchSequence(responses: Response[]) {
  const fetchMock = vi.spyOn(globalThis, "fetch");
  for (const res of responses) {
    fetchMock.mockResolvedValueOnce(res);
  }
  return fetchMock;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  navigateMock.mockReset();
  searchParamsMock.get.mockReset();
  searchParamsMock.get.mockReturnValue(null);
  sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("PreviewPage", () => {
  it("hydrates form fields from sessionStorage in normal mode", async () => {
    sessionStorage.setItem(
      EXTRACT_STORAGE_KEY,
      JSON.stringify(successExtract),
    );
    mockFetchSequence([jsonResponse(calendarListResponse)]);

    render(<PreviewPage />);

    expect(
      (screen.getByLabelText(/タイトル/) as HTMLInputElement).value,
    ).toBe("ミーティング");
    expect(
      (screen.getByLabelText(/場所/) as HTMLInputElement).value,
    ).toBe("渋谷");

    // Calendar selector populates from /api/calendar/list.
    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: /書込先/ })).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByRole("option", { name: /メイン/ })).toBeInTheDocument();
    });
  });

  it("redirects to / when sessionStorage is empty in normal mode", async () => {
    mockFetchSequence([jsonResponse(calendarListResponse)]);

    render(<PreviewPage />);

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith("/");
    });
  });

  it("renders an empty form in manual mode (?manual=1) without reading sessionStorage", async () => {
    searchParamsMock.get.mockImplementation((key: string) =>
      key === "manual" ? "1" : null,
    );
    sessionStorage.setItem(
      EXTRACT_STORAGE_KEY,
      JSON.stringify(successExtract),
    );
    mockFetchSequence([jsonResponse(calendarListResponse)]);

    render(<PreviewPage />);

    expect((screen.getByLabelText(/タイトル/) as HTMLInputElement).value).toBe(
      "",
    );
    expect((screen.getByLabelText(/場所/) as HTMLInputElement).value).toBe("");
    // Manual mode must not navigate away even when storage is empty.
    expect(navigateMock).not.toHaveBeenCalledWith("/");
  });

  it("shows the multipleDetected warning banner when the flag is true", async () => {
    sessionStorage.setItem(
      EXTRACT_STORAGE_KEY,
      JSON.stringify({ ...successExtract, multipleDetected: true }),
    );
    mockFetchSequence([jsonResponse(calendarListResponse)]);

    render(<PreviewPage />);

    expect(await screen.findByText(/複数のイベント/)).toBeInTheDocument();
  });

  it("blocks submit when end date/time is before start date/time", async () => {
    sessionStorage.setItem(
      EXTRACT_STORAGE_KEY,
      JSON.stringify(successExtract),
    );
    mockFetchSequence([jsonResponse(calendarListResponse)]);

    render(<PreviewPage />);

    // Move the end backward so it precedes the start.
    fireEvent.change(screen.getByLabelText(/終了/), {
      target: { value: "2026-05-10T09:00" },
    });

    const submit = screen.getByRole("button", { name: /カレンダーに登録/ });
    expect(submit).toBeDisabled();
  });

  it("submits a correctly shaped payload to /api/calendar/insert", async () => {
    sessionStorage.setItem(
      EXTRACT_STORAGE_KEY,
      JSON.stringify(successExtract),
    );
    const fetchMock = mockFetchSequence([
      jsonResponse(calendarListResponse),
      jsonResponse({
        ok: true,
        id: "evt_123",
        htmlLink: "https://calendar.google.com/event?eid=abc",
      }),
    ]);

    render(<PreviewPage />);

    await waitFor(() => {
      expect(screen.getByRole("option", { name: /メイン/ })).toBeInTheDocument();
    });

    // Slight title edit to confirm edited values flow through.
    fireEvent.change(screen.getByLabelText(/タイトル/), {
      target: { value: "編集後タイトル" },
    });

    fireEvent.click(screen.getByRole("button", { name: /カレンダーに登録/ }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/calendar/insert",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
          }),
        }),
      );
    });

    const insertCall = fetchMock.mock.calls.find(
      ([url]) => url === "/api/calendar/insert",
    );
    expect(insertCall).toBeTruthy();
    const body = JSON.parse((insertCall![1] as RequestInit).body as string);
    expect(body.calendarId).toBe("primary");
    expect(body.event.title).toBe("編集後タイトル");
    expect(body.event.startISO).toBe("2026-05-10T10:00:00+09:00");
    expect(body.event.endISO).toBe("2026-05-10T11:00:00+09:00");
    expect(body.event.location).toBe("渋谷");
    // Empty url stays null (form normalises empty -> null on submit).
    expect(body.event.url).toBeNull();

    // Success view appears with the htmlLink.
    expect(
      await screen.findByRole("link", { name: /Google カレンダーで開く/ }),
    ).toHaveAttribute("href", "https://calendar.google.com/event?eid=abc");
  });

  it("preserves end-date across is-all-day toggle (uses end's date part as-is)", async () => {
    // Single-day timed event → toggling all-day should keep it single-day.
    sessionStorage.setItem(
      EXTRACT_STORAGE_KEY,
      JSON.stringify({
        ok: true,
        event: {
          title: "test",
          startISO: "2026-05-04T10:00:00+09:00",
          endISO: "2026-05-04T11:00:00+09:00",
          isAllDay: false,
          location: null,
          url: null,
          description: null,
        },
        multipleDetected: false,
        pastDateWarning: false,
      }),
    );
    const fetchMock = mockFetchSequence([
      jsonResponse(calendarListResponse),
      jsonResponse({
        ok: true,
        id: "evt_allday",
        htmlLink: "https://calendar.google.com/event?eid=allday",
      }),
    ]);

    render(<PreviewPage />);

    await waitFor(() => {
      expect(screen.getByRole("option", { name: /メイン/ })).toBeInTheDocument();
    });

    // Toggle the all-day checkbox.
    const allDayToggle = screen.getByLabelText(/終日イベント/) as HTMLInputElement;
    fireEvent.click(allDayToggle);

    // The visible inputs become date pickers with the same single date.
    const startInput = screen.getByLabelText(/開始/) as HTMLInputElement;
    const endInput = screen.getByLabelText(/終了/) as HTMLInputElement;
    expect(startInput.value).toBe("2026-05-04");
    expect(endInput.value).toBe("2026-05-04");

    fireEvent.click(screen.getByRole("button", { name: /カレンダーに登録/ }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/calendar/insert",
        expect.objectContaining({ method: "POST" }),
      );
    });

    const insertCall = fetchMock.mock.calls.find(
      ([url]) => url === "/api/calendar/insert",
    );
    const body = JSON.parse((insertCall![1] as RequestInit).body as string);
    // All-day events are encoded with midnight JST and an exclusive next-day end.
    expect(body.event.isAllDay).toBe(true);
    expect(body.event.startISO).toBe("2026-05-04T00:00:00+09:00");
    expect(body.event.endISO).toBe("2026-05-05T00:00:00+09:00");
  });

  it("submits a manual-mode payload to /api/calendar/insert", async () => {
    searchParamsMock.get.mockImplementation((key: string) =>
      key === "manual" ? "1" : null,
    );
    const fetchMock = mockFetchSequence([
      jsonResponse(calendarListResponse),
      jsonResponse({
        ok: true,
        id: "evt_manual",
        htmlLink: "https://calendar.google.com/event?eid=manual",
      }),
    ]);

    render(<PreviewPage />);

    await waitFor(() => {
      expect(screen.getByRole("option", { name: /メイン/ })).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText(/タイトル/), {
      target: { value: "手入力タイトル" },
    });
    fireEvent.change(screen.getByLabelText(/開始/), {
      target: { value: "2026-06-01T09:00" },
    });
    fireEvent.change(screen.getByLabelText(/終了/), {
      target: { value: "2026-06-01T10:00" },
    });

    fireEvent.click(screen.getByRole("button", { name: /カレンダーに登録/ }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/calendar/insert",
        expect.objectContaining({ method: "POST" }),
      );
    });

    const insertCall = fetchMock.mock.calls.find(
      ([url]) => url === "/api/calendar/insert",
    );
    const body = JSON.parse((insertCall![1] as RequestInit).body as string);
    expect(body.calendarId).toBe("primary");
    expect(body.event).toEqual({
      title: "手入力タイトル",
      startISO: "2026-06-01T09:00:00+09:00",
      endISO: "2026-06-01T10:00:00+09:00",
      isAllDay: false,
      location: null,
      url: null,
      description: null,
    });
  });

  it("renders a banner when pastDateWarning is true", async () => {
    sessionStorage.setItem(
      EXTRACT_STORAGE_KEY,
      JSON.stringify({ ...successExtract, pastDateWarning: true }),
    );
    mockFetchSequence([jsonResponse(calendarListResponse)]);

    render(<PreviewPage />);

    expect(await screen.findByText(/過去の日付/)).toBeInTheDocument();
  });

  it("shows the re-sign-in message when /api/calendar/insert returns 401", async () => {
    sessionStorage.setItem(
      EXTRACT_STORAGE_KEY,
      JSON.stringify(successExtract),
    );
    mockFetchSequence([
      jsonResponse(calendarListResponse),
      jsonResponse({ ok: false, error: "unauthorized" }, 401),
    ]);

    render(<PreviewPage />);

    await waitFor(() => {
      expect(screen.getByRole("option", { name: /メイン/ })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /カレンダーに登録/ }));

    expect(
      await screen.findByText(/サインインの有効期限が切れました/),
    ).toBeInTheDocument();
  });
});
