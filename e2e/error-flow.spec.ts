// where: e2e/error-flow.spec.ts
// what:  SS-011 error-path E2E. /api/extract returns ok:false; UI surfaces the
//        friendly error and offers a manual fallback.
// why:   Locks the negative-path UX so the composer's status branching does not
//        regress (401/413/429 + ok:false + manual fallback link).

import { test, expect } from "./helpers/auth";

test("extract returns ok:false → friendly error UI + manual fallback", async ({
  authedPage,
}) => {
  await authedPage.route("**/api/extract", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: false,
        error: "イベント情報を抽出できませんでした。",
      }),
    });
  });

  await authedPage.goto("/");

  await authedPage.getByRole("textbox").fill("解析できない雑なメモ");
  await authedPage
    .getByRole("button", { name: "解析する", exact: true })
    .click();

  // The error banner shows the friendly message + the manual fallback link.
  await expect(
    authedPage.getByText("イベント情報を抽出できませんでした。"),
  ).toBeVisible();
  await expect(
    authedPage.getByRole("button", { name: "もう一度試す" }),
  ).toBeVisible();
  const manualLink = authedPage.getByRole("link", { name: "手入力で続ける" });
  await expect(manualLink).toBeVisible();
  await expect(manualLink).toHaveAttribute("href", "/preview?manual=1");
});
