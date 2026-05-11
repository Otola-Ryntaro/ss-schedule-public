// where: e2e/text-flow.spec.ts
// what:  SS-011 happy-path E2E. Authenticated user pastes text, /api/extract returns
//        a fixed event, user lands on /preview, picks a calendar, submits, sees the
//        Google Calendar link.
// why:   Locks the end-to-end UX wiring (text → /api/extract → sessionStorage →
//        /preview hydration → /api/calendar/list selector → /api/calendar/insert →
//        success panel) without depending on Gemini or Google Calendar in CI.

import { test, expect } from "./helpers/auth";

const fixedExtractResponse = {
  ok: true,
  event: {
    title: "歯医者",
    startISO: "2026-05-10T14:00:00+09:00",
    endISO: "2026-05-10T15:00:00+09:00",
    isAllDay: false,
    location: "渋谷",
    url: null,
    description: null,
  },
  multipleDetected: false,
  pastDateWarning: false,
};

const fixedCalendarList = {
  calendars: [
    {
      id: "primary@example.com",
      summary: "個人",
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

test("text paste → preview → calendar insert", async ({ authedPage }) => {
  await authedPage.route("**/api/extract", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(fixedExtractResponse),
    });
  });

  await authedPage.route("**/api/calendar/list", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(fixedCalendarList),
    });
  });

  await authedPage.route("**/api/calendar/insert", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        id: "evt-123",
        htmlLink: "https://calendar.google.com/event?eid=evt-123",
      }),
    });
  });

  await authedPage.goto("/");

  // Composer is visible (signed-in branch of app/page.tsx).
  await expect(
    authedPage.getByRole("heading", { name: "SS_schedule" }),
  ).toBeVisible();

  // Paste text and submit. The text panel button is the one inside the right column.
  const textarea = authedPage.getByRole("textbox");
  await textarea.fill("5月10日 14時から15時 歯医者 渋谷");

  await authedPage
    .getByRole("button", { name: "解析する", exact: true })
    .click();

  // /preview hydrates from sessionStorage and shows the title.
  await authedPage.waitForURL("**/preview");
  await expect(authedPage.locator("#title")).toHaveValue("歯医者");
  await expect(authedPage.locator("#location")).toHaveValue("渋谷");

  // Calendar selector should default to the primary entry.
  const calendarSelect = authedPage.getByLabel("書込先カレンダー");
  await expect(calendarSelect).toHaveValue("primary@example.com");

  // Submit and verify success panel + htmlLink.
  await authedPage.getByRole("button", { name: "カレンダーに登録" }).click();
  await expect(authedPage.getByText("カレンダーに登録しました。")).toBeVisible();
  const link = authedPage.getByRole("link", {
    name: "Google カレンダーで開く",
  });
  await expect(link).toHaveAttribute(
    "href",
    "https://calendar.google.com/event?eid=evt-123",
  );
});

test("image upload → preview (minimal smoke)", async ({ authedPage }) => {
  await authedPage.route("**/api/extract", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(fixedExtractResponse),
    });
  });
  await authedPage.route("**/api/calendar/list", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(fixedCalendarList),
    });
  });

  await authedPage.goto("/");

  // Tiny 1x1 PNG so file-type doesn't reject it on the API boundary (the API
  // is mocked, but the client may still validate accept). 1x1 transparent.
  const pngBase64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
  const pngBuffer = Buffer.from(pngBase64, "base64");

  const fileInput = authedPage.locator('input[type="file"]').first();
  await fileInput.setInputFiles({
    name: "test.png",
    mimeType: "image/png",
    buffer: pngBuffer,
  });

  await authedPage.getByRole("button", { name: "画像を解析する" }).click();
  await authedPage.waitForURL("**/preview");
  await expect(authedPage.locator("#title")).toHaveValue("歯医者");
});
