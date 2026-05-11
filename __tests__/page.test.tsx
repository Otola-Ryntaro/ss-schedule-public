// where: __tests__/page.test.tsx
// what:  React Testing Library tests for the screenshot composer client component
//        (the interactive heart of `app/page.tsx`).
// why:   The page is a Server Component (auth() + JSX); its branches are exercised at
//        the integration level. The behaviour we need to lock down — UI rendering when
//        signed in, fetch on submit, success navigation, and the manual fallback flow —
//        all lives in the composer client component, so we test that surface directly.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { ScreenshotComposer } from "@/components/screenshot-composer";

const navigateMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: navigateMock,
    replace: navigateMock,
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

const successResponse = {
  ok: true,
  event: {
    title: "ミーティング",
    startISO: "2026-05-10T10:00:00+09:00",
    endISO: "2026-05-10T11:00:00+09:00",
    isAllDay: false,
    location: null,
    url: null,
    description: null,
  },
  multipleDetected: false,
  pastDateWarning: false,
};

beforeEach(() => {
  navigateMock.mockReset();
  // sessionStorage is provided by jsdom; make sure each test starts clean.
  sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ScreenshotComposer", () => {
  it("renders image and text inputs plus the analyze button when signed in", () => {
    render(<ScreenshotComposer email="user@example.com" signOutSlot={null} />);

    expect(
      screen.getByRole("button", { name: /写真を選ぶ/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /カメラで撮影/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText(/予定情報を含むテキスト/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "解析する" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /画像を解析する/ }),
    ).toBeInTheDocument();
    expect(screen.getByText("user@example.com")).toBeInTheDocument();
  });

  it("calls /api/extract with JSON when the user submits text", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(successResponse), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    render(<ScreenshotComposer email="user@example.com" signOutSlot={null} />);

    const textarea = screen.getByPlaceholderText(/予定情報を含むテキスト/);
    fireEvent.change(textarea, { target: { value: "5/10 10時 ミーティング" } });
    fireEvent.click(screen.getByRole("button", { name: "解析する" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/extract",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
          }),
        }),
      );
    });

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith("/preview");
    });

    const stored = sessionStorage.getItem("ss-schedule.extract");
    expect(stored).toBeTruthy();
    expect(JSON.parse(stored!).event.title).toBe("ミーティング");
  });

  it("shows the friendly error and the manual-fallback link when extraction fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: false,
          error: "読み取れませんでした、もう一度試すか手動で登録してください",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    render(<ScreenshotComposer email="user@example.com" signOutSlot={null} />);

    fireEvent.change(screen.getByPlaceholderText(/予定情報を含むテキスト/), {
      target: { value: "壊れたテキスト" },
    });
    fireEvent.click(screen.getByRole("button", { name: "解析する" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/読み取れませんでした/);

    expect(
      screen.getByRole("button", { name: /もう一度試す/ }),
    ).toBeInTheDocument();
    const manual = screen.getByRole("link", { name: /手入力で続ける/ });
    expect(manual).toHaveAttribute("href", "/preview?manual=1");
  });
});
