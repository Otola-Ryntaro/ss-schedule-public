// where: components/preview-form.tsx
// what:  Pure form view used by /preview. Takes form state + handlers from the page
//        and renders the editable fields (title / dates / location / url / memo /
//        calendar selector). Includes M2 layout density (start/end side-by-side,
//        optional fields collapsed) and M3 quick-adjust chips for datetimes.
// why:   Splitting the JSX out keeps app/preview/page.tsx focused on hydration,
//        validation, and submission orchestration.

"use client";

import type { Dispatch, SetStateAction } from "react";
import { Loader2 } from "lucide-react";
import { CalendarSelector } from "@/components/calendar-selector";
import {
  addDaysToLocal,
  addMinutesLocal,
} from "@/lib/preview-datetime";

export type PreviewFormState = {
  title: string;
  startLocal: string;
  endLocal: string;
  isAllDay: boolean;
  location: string;
  url: string;
  description: string;
};

type PreviewFormProps = {
  form: PreviewFormState;
  setForm: Dispatch<SetStateAction<PreviewFormState>>;
  calendarId: string;
  onCalendarIdChange: (id: string) => void;
  endBeforeStart: boolean;
  canSubmit: boolean;
  submitting: boolean;
  errorMessage: string | null;
  onSubmit: () => void;
};

export function PreviewForm({
  form,
  setForm,
  calendarId,
  onCalendarIdChange,
  endBeforeStart,
  canSubmit,
  submitting,
  errorMessage,
  onSubmit,
}: PreviewFormProps) {
  // M3 quick-adjust handlers. End-only adjustments shift just the end (typical
  // "extend the meeting"), while day-shift adjustments move both ends so the
  // duration stays intact.
  function shiftEndMinutes(minutes: number) {
    setForm((prev) =>
      prev.isAllDay
        ? prev
        : { ...prev, endLocal: addMinutesLocal(prev.endLocal, minutes) },
    );
  }

  function shiftBothDays(days: number) {
    setForm((prev) => ({
      ...prev,
      startLocal: addDaysToLocal(prev.startLocal, days),
      endLocal: addDaysToLocal(prev.endLocal, days),
    }));
  }

  return (
    <form
      className="flex flex-col gap-4 rounded-2xl border border-black/[.08] bg-white p-4 dark:border-white/[.08] dark:bg-zinc-950"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <Field label="タイトル" htmlFor="title" required>
        <input
          id="title"
          type="text"
          aria-label="タイトル"
          value={form.title}
          onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
          required
          className={inputClass}
        />
      </Field>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={form.isAllDay}
          onChange={(e) => {
            const isAllDay = e.target.checked;
            // Convert between datetime-local and date format when toggling.
            setForm((prev) => ({
              ...prev,
              isAllDay,
              startLocal: isAllDay
                ? prev.startLocal.slice(0, 10)
                : prev.startLocal.length === 10
                  ? `${prev.startLocal}T00:00`
                  : prev.startLocal,
              endLocal: isAllDay
                ? prev.endLocal.slice(0, 10)
                : prev.endLocal.length === 10
                  ? `${prev.endLocal}T01:00`
                  : prev.endLocal,
            }));
          }}
        />
        <span className="text-zinc-700 dark:text-zinc-200">終日イベント</span>
      </label>

      {/* M2: start/end side-by-side on >= sm so the form takes less vertical space.
          On narrow viewports they stack so each input remains touch-friendly. */}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="開始" htmlFor="start" required>
          <input
            id="start"
            type={form.isAllDay ? "date" : "datetime-local"}
            aria-label="開始"
            value={form.startLocal}
            onChange={(e) =>
              setForm((prev) => ({ ...prev, startLocal: e.target.value }))
            }
            required
            className={inputClass}
          />
        </Field>

        <Field label="終了" htmlFor="end" required>
          <input
            id="end"
            type={form.isAllDay ? "date" : "datetime-local"}
            aria-label="終了"
            value={form.endLocal}
            onChange={(e) =>
              setForm((prev) => ({ ...prev, endLocal: e.target.value }))
            }
            required
            className={inputClass}
          />
          {endBeforeStart ? (
            <p className="mt-1 text-xs text-red-700 dark:text-red-300">
              終了は開始以降にしてください。
            </p>
          ) : null}
        </Field>
      </div>

      {/* M3: quick-adjust chips. Hidden in all-day mode where minute deltas don't apply. */}
      <div className="flex flex-wrap items-center gap-2">
        {!form.isAllDay ? (
          <>
            <Chip onClick={() => shiftEndMinutes(15)}>終了 +15分</Chip>
            <Chip onClick={() => shiftEndMinutes(60)}>終了 +1時間</Chip>
          </>
        ) : null}
        <Chip onClick={() => shiftBothDays(1)}>翌日</Chip>
        <Chip onClick={() => shiftBothDays(7)}>来週</Chip>
      </div>

      {/* M2: secondary fields (location / URL / memo) start collapsed to reduce
          scroll length. The native <details> element keeps a11y + keyboard support
          without pulling in extra Radix primitives. */}
      <details className="group rounded-xl border border-black/[.08] dark:border-white/[.08]">
        <summary className="flex min-h-11 cursor-pointer touch-manipulation list-none items-center justify-between rounded-xl px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-black/[.03] dark:text-zinc-200 dark:hover:bg-white/[.03]">
          <span>場所・URL・メモ（任意）</span>
          <span
            aria-hidden
            className="text-xs text-zinc-500 transition-transform group-open:rotate-180 dark:text-zinc-400"
          >
            ▾
          </span>
        </summary>
        <div className="flex flex-col gap-4 px-3 pb-3 pt-1">
          <Field label="場所" htmlFor="location">
            <input
              id="location"
              type="text"
              value={form.location}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, location: e.target.value }))
              }
              className={inputClass}
            />
          </Field>

          <Field label="URL" htmlFor="url">
            <input
              id="url"
              type="url"
              value={form.url}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, url: e.target.value }))
              }
              placeholder="https://…"
              className={inputClass}
            />
          </Field>

          <Field label="メモ" htmlFor="description">
            <textarea
              id="description"
              value={form.description}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, description: e.target.value }))
              }
              rows={4}
              className={`${inputClass} min-h-24 resize-y`}
            />
          </Field>
        </div>
      </details>

      <CalendarSelector
        value={calendarId}
        onChange={onCalendarIdChange}
        disabled={submitting}
      />

      {errorMessage ? (
        <p
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-100"
        >
          {errorMessage}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={!canSubmit}
        className="inline-flex min-h-11 touch-manipulation items-center justify-center gap-2 rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-[#383838] disabled:opacity-50 dark:hover:bg-[#ccc]"
      >
        {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
        カレンダーに登録
      </button>
    </form>
  );
}

const inputClass =
  "w-full rounded-xl border border-black/[.1] bg-white px-3 py-2 text-sm outline-none focus:border-foreground disabled:opacity-60 dark:border-white/[.15] dark:bg-zinc-900";

function Field({
  label,
  htmlFor,
  required,
  children,
}: {
  label: string;
  htmlFor: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label
        htmlFor={htmlFor}
        className="text-xs font-medium text-zinc-700 dark:text-zinc-200"
      >
        {label}
        {required ? (
          <span className="ml-1 text-red-700 dark:text-red-300">*</span>
        ) : null}
      </label>
      {children}
    </div>
  );
}

function Chip({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-9 touch-manipulation items-center rounded-full border border-black/[.1] bg-white px-3 py-1 text-xs font-medium text-zinc-700 transition-colors hover:bg-black/[.04] dark:border-white/[.15] dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-white/[.05]"
    >
      {children}
    </button>
  );
}
