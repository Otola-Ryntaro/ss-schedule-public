// where: app/preview/page.tsx
// what:  Preview / edit form (SS-010). Hydrates from the SS-009 sessionStorage
//        payload, or starts blank when ?manual=1. Posts a re-validated ExtractedEvent
//        to /api/calendar/insert and shows the resulting Google Calendar link.
// why:   Auth is enforced upstream by proxy.ts; this page is purely client state. JST
//        is fixed for MVP, so datetime-local conversion is done with simple string
//        slicing (the ISO always carries "+09:00") to avoid TZ-aware date math here.

"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PreviewForm, type PreviewFormState } from "@/components/preview-form";
import {
  ExtractResponseSchema,
  ExtractedEventSchema,
  InsertConflictResponseSchema,
  type ConflictEvent,
  type ExtractedEvent,
} from "@/lib/schema";
import { EXTRACT_STORAGE_KEY } from "@/lib/storage-keys";
import {
  addDaysToYMD,
  addOneHourLocal,
  isoToDate,
  isoToDatetimeLocal,
  localToJSTISO,
  nowJSTLocal,
} from "@/lib/preview-datetime";

// ───────────────────────────────────────────────
// Form initialisation + serialisation
// ───────────────────────────────────────────────

function emptyForm(): PreviewFormState {
  const startLocal = nowJSTLocal();
  return {
    title: "",
    startLocal,
    endLocal: addOneHourLocal(startLocal),
    isAllDay: false,
    location: "",
    url: "",
    description: "",
  };
}

function eventToForm(event: ExtractedEvent): PreviewFormState {
  // Google's all-day end is exclusive (next day). Subtract 1 day to display the
  // user-friendly inclusive last day; we re-add it on submit.
  const startLocal = event.isAllDay
    ? isoToDate(event.startISO)
    : isoToDatetimeLocal(event.startISO);
  const endLocal = event.isAllDay
    ? addDaysToYMD(isoToDate(event.endISO), -1)
    : isoToDatetimeLocal(event.endISO);
  return {
    title: event.title,
    startLocal,
    endLocal,
    isAllDay: event.isAllDay,
    location: event.location ?? "",
    url: event.url ?? "",
    description: event.description ?? "",
  };
}

function buildEventFromForm(
  form: PreviewFormState,
): { ok: true; event: ExtractedEvent } | { ok: false; error: string } {
  const startISO = localToJSTISO(form.startLocal, form.isAllDay);
  // For all-day events the API expects an exclusive end date (last day + 1).
  const endLocal = form.isAllDay
    ? addDaysToYMD(form.endLocal, 1)
    : form.endLocal;
  const endISO = localToJSTISO(endLocal, form.isAllDay);

  const candidate = {
    title: form.title.trim(),
    startISO,
    endISO,
    isAllDay: form.isAllDay,
    location: form.location.trim() ? form.location.trim() : null,
    url: form.url.trim() ? form.url.trim() : null,
    description: form.description.trim() ? form.description.trim() : null,
  };

  const parsed = ExtractedEventSchema.safeParse(candidate);
  if (!parsed.success) {
    return { ok: false, error: "入力内容を確認してください" };
  }
  return { ok: true, event: parsed.data };
}

// ───────────────────────────────────────────────
// Page
// ───────────────────────────────────────────────

type SubmitState =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "success"; htmlLink: string }
  | { status: "error"; message: string }
  | { status: "conflict"; conflicts: ConflictEvent[] };

export default function PreviewPage() {
  // useSearchParams() forces this subtree out of static prerender; wrapping it in
  // a Suspense boundary lets Next.js bail to client-side rendering cleanly.
  return (
    <Suspense fallback={null}>
      <PreviewPageInner />
    </Suspense>
  );
}

function PreviewPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isManual = searchParams.get("manual") === "1";

  const [form, setForm] = useState<PreviewFormState>(() => emptyForm());
  const [calendarId, setCalendarId] = useState<string>("");
  const [multipleDetected, setMultipleDetected] = useState(false);
  const [pastDateWarning, setPastDateWarning] = useState(false);
  const [submit, setSubmit] = useState<SubmitState>({ status: "idle" });
  // Tracks the initial hydration so the submit button waits for storage / mode.
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (isManual) {
      setForm(emptyForm());
      setHydrated(true);
      return;
    }

    const raw = sessionStorage.getItem(EXTRACT_STORAGE_KEY);
    if (!raw) {
      router.push("/");
      return;
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch {
      router.push("/");
      return;
    }

    const parsed = ExtractResponseSchema.safeParse(parsedJson);
    if (!parsed.success || !parsed.data.ok) {
      router.push("/");
      return;
    }

    setForm(eventToForm(parsed.data.event));
    setMultipleDetected(parsed.data.multipleDetected);
    setPastDateWarning(parsed.data.pastDateWarning);
    setHydrated(true);
    // router is referentially stable in real Next.js but not in test mocks; we
    // only want this effect to re-run when the manual flag changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isManual]);

  const endBeforeStart = useMemo(() => {
    if (!form.startLocal || !form.endLocal) return false;
    // String comparison works because both values are zero-padded ISO-like.
    return form.endLocal < form.startLocal;
  }, [form.startLocal, form.endLocal]);

  const canSubmit =
    hydrated &&
    !endBeforeStart &&
    form.title.trim().length > 0 &&
    !!form.startLocal &&
    !!form.endLocal &&
    !!calendarId &&
    submit.status !== "submitting";

  async function postInsert(event: ExtractedEvent, confirmConflicts: boolean) {
    setSubmit({ status: "submitting" });
    try {
      const res = await fetch("/api/calendar/insert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ calendarId, event, confirmConflicts }),
      });
      const json: unknown = await res.json().catch(() => null);

      // SS-014: 409 means existing events overlap. Show the confirmation banner.
      if (res.status === 409) {
        const parsed = InsertConflictResponseSchema.safeParse(json);
        if (parsed.success) {
          setSubmit({ status: "conflict", conflicts: parsed.data.conflicts });
          return;
        }
        setSubmit({
          status: "error",
          message: "カレンダーへの登録に失敗しました。",
        });
        return;
      }

      if (!res.ok || !isInsertSuccess(json)) {
        // Differentiate by status to give actionable hints. Mirrors SS-009 main UI.
        let message: string;
        if (res.status === 401) {
          message = "サインインの有効期限が切れました。";
        } else if (res.status === 403) {
          message =
            "リクエストが拒否されました（CSRF 検証失敗）。ページを再読み込みしてください。";
        } else if (res.status === 400) {
          message = "入力内容が不正です。";
        } else if (res.status === 502) {
          message =
            "カレンダー側で一時的なエラーが発生しました。しばらくしてから再試行してください。";
        } else {
          message = "カレンダーへの登録に失敗しました。";
        }
        setSubmit({ status: "error", message });
        return;
      }
      setSubmit({ status: "success", htmlLink: json.htmlLink });
      // Clear stored extract so re-visiting /preview without manual=1 falls back to /.
      sessionStorage.removeItem(EXTRACT_STORAGE_KEY);
    } catch {
      setSubmit({
        status: "error",
        message: "ネットワークエラーが発生しました。",
      });
    }
  }

  async function handleSubmit() {
    if (!canSubmit) return;
    const built = buildEventFromForm(form);
    if (!built.ok) {
      setSubmit({ status: "error", message: built.error });
      return;
    }
    await postInsert(built.event, false);
  }

  async function handleConfirmConflict() {
    const built = buildEventFromForm(form);
    if (!built.ok) {
      setSubmit({ status: "error", message: built.error });
      return;
    }
    await postInsert(built.event, true);
  }

  function handleDismissConflict() {
    setSubmit({ status: "idle" });
  }

  function handleAddAnother() {
    setSubmit({ status: "idle" });
    setForm(emptyForm());
    setMultipleDetected(false);
    setPastDateWarning(false);
    // Land back on home — manual mode is opt-in, default flow is screenshot/text.
    router.push("/");
  }

  return (
    <div className="flex min-h-screen flex-1 flex-col bg-zinc-50 font-sans dark:bg-black">
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-5 px-4 py-8 sm:px-6 lg:py-10">
        <header>
          <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
            予定の確認・編集
          </h1>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {isManual
              ? "手入力モード — 各項目を入力してカレンダーに登録します。"
              : "抽出結果を確認・編集してから登録してください。"}
          </p>
        </header>

        {multipleDetected ? (
          <Banner>
            複数のイベントが検出されました。先頭のイベントのみ表示しています。
          </Banner>
        ) : null}

        {pastDateWarning ? (
          <Banner>過去の日付が指定されています。内容をご確認ください。</Banner>
        ) : null}

        {submit.status === "success" ? (
          <SuccessPanel
            htmlLink={submit.htmlLink}
            onAddAnother={handleAddAnother}
          />
        ) : (
          <>
            {submit.status === "conflict" ? (
              <ConflictPanel
                conflicts={submit.conflicts}
                onConfirm={handleConfirmConflict}
                onDismiss={handleDismissConflict}
              />
            ) : null}
            <PreviewForm
              form={form}
              setForm={setForm}
              calendarId={calendarId}
              onCalendarIdChange={setCalendarId}
              endBeforeStart={endBeforeStart}
              canSubmit={canSubmit}
              submitting={submit.status === "submitting"}
              errorMessage={
                submit.status === "error" ? submit.message : null
              }
              onSubmit={handleSubmit}
            />
          </>
        )}
      </main>
    </div>
  );
}

// ───────────────────────────────────────────────
// Sub-components
// ───────────────────────────────────────────────

function Banner({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="status"
      className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-100"
    >
      {children}
    </div>
  );
}

// SS-014: shows existing events that overlap the new one and lets the user
// either proceed (re-submit with confirmConflicts: true) or go back to edit.
function ConflictPanel({
  conflicts,
  onConfirm,
  onDismiss,
}: {
  conflicts: ConflictEvent[];
  onConfirm: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-900 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-100"
    >
      <p className="font-medium">同じ時間帯に既存の予定があります。</p>
      <ul className="ml-4 list-disc space-y-1 text-xs">
        {conflicts.map((c) => (
          <li key={c.id}>
            <span className="font-medium">{c.title}</span>
            <span className="ml-2 text-red-800 dark:text-red-200">
              {formatConflictRange(c)}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-xs">それでも登録しますか？</p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onConfirm}
          className="inline-flex min-h-11 touch-manipulation items-center gap-2 rounded-full bg-red-900 px-4 py-2 text-sm font-medium text-white hover:bg-red-800 dark:bg-red-100 dark:text-red-900 dark:hover:bg-red-200"
        >
          それでも登録
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="inline-flex min-h-11 touch-manipulation items-center gap-2 rounded-full border border-red-300 px-4 py-2 text-sm font-medium text-red-900 hover:bg-red-100 dark:border-red-800 dark:text-red-100 dark:hover:bg-red-900/40"
        >
          戻る
        </button>
      </div>
    </div>
  );
}

// Format "MM/DD HH:mm〜HH:mm" or "MM/DD 終日" for display. We treat the ISO as
// already-localised JST text (the ISO carries +09:00) and slice by string offsets
// to avoid TZ-aware date math, mirroring the existing /preview convention.
function formatConflictRange(conflict: ConflictEvent): string {
  if (conflict.isAllDay) {
    const startDate = conflict.startISO.slice(5, 10).replace("-", "/");
    return `${startDate} 終日`;
  }
  const startDate = conflict.startISO.slice(5, 10).replace("-", "/");
  const startTime = conflict.startISO.slice(11, 16);
  const endTime = conflict.endISO.slice(11, 16);
  return `${startDate} ${startTime}〜${endTime}`;
}

function SuccessPanel({
  htmlLink,
  onAddAnother,
}: {
  htmlLink: string;
  onAddAnother: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-100">
      <p className="font-medium">カレンダーに登録しました。</p>
      <a
        href={htmlLink}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex min-h-11 w-fit touch-manipulation items-center gap-2 rounded-full bg-emerald-900 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800 dark:bg-emerald-100 dark:text-emerald-900 dark:hover:bg-emerald-200"
      >
        Google カレンダーで開く
      </a>
      <button
        type="button"
        onClick={onAddAnother}
        className="inline-flex min-h-11 w-fit touch-manipulation items-center gap-2 rounded-full border border-emerald-300 px-4 py-2 text-sm font-medium text-emerald-900 hover:bg-emerald-100 dark:border-emerald-800 dark:text-emerald-100 dark:hover:bg-emerald-900/40"
      >
        もう一件登録
      </button>
    </div>
  );
}

// ───────────────────────────────────────────────
// Type guard for /api/calendar/insert success body
// ───────────────────────────────────────────────

function isInsertSuccess(
  json: unknown,
): json is { ok: true; id: string; htmlLink: string } {
  if (typeof json !== "object" || json === null) return false;
  const j = json as Record<string, unknown>;
  return (
    j.ok === true &&
    typeof j.id === "string" &&
    typeof j.htmlLink === "string"
  );
}
