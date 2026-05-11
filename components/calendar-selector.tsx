// where: components/calendar-selector.tsx
// what:  Client-side dropdown that lists the user's writable Google calendars.
// why:   The preview form needs a "where to write" picker. Fetching here keeps the
//        form decoupled from the network call and lets the picker own its loading /
//        error states. The response is re-validated with CalendarListResponseSchema
//        so a malformed payload becomes a friendly error instead of a runtime crash.

"use client";

import { useEffect, useState } from "react";
import {
  CalendarListResponseSchema,
  type CalendarListEntry,
} from "@/lib/schema";

type CalendarSelectorProps = {
  value: string;
  onChange: (calendarId: string) => void;
  disabled?: boolean;
};

type FetchState =
  | { status: "loading" }
  | { status: "ready"; calendars: CalendarListEntry[] }
  | { status: "error"; message: string };

export function CalendarSelector({
  value,
  onChange,
  disabled,
}: CalendarSelectorProps) {
  const [state, setState] = useState<FetchState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch("/api/calendar/list", {
          headers: { Accept: "application/json" },
        });
        if (!res.ok) {
          if (!cancelled) {
            setState({
              status: "error",
              message:
                res.status === 401
                  ? "サインインの有効期限が切れました。"
                  : "カレンダー一覧を取得できませんでした。",
            });
          }
          return;
        }
        const json: unknown = await res.json().catch(() => null);
        const parsed = CalendarListResponseSchema.safeParse(json);
        if (!parsed.success) {
          if (!cancelled) {
            setState({
              status: "error",
              message: "カレンダー一覧の形式が不正です。",
            });
          }
          return;
        }
        if (cancelled) return;
        setState({ status: "ready", calendars: parsed.data.calendars });

        // Default selection: prefer the entry flagged primary, otherwise the first.
        if (!value && parsed.data.calendars.length > 0) {
          const primary =
            parsed.data.calendars.find((c) => c.primary) ??
            parsed.data.calendars[0];
          onChange(primary.id);
        }
      } catch {
        if (!cancelled) {
          setState({
            status: "error",
            message: "カレンダー一覧の取得に失敗しました。",
          });
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
    // We intentionally run this once on mount; value/onChange are not dependencies
    // to avoid re-fetching when the parent re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col gap-1">
      <label
        htmlFor="calendar-selector"
        className="text-xs font-medium text-zinc-700 dark:text-zinc-200"
      >
        書込先カレンダー
      </label>
      <select
        id="calendar-selector"
        aria-label="書込先カレンダー"
        value={value}
        disabled={disabled || state.status !== "ready"}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-xl border border-black/[.1] bg-white px-3 py-2 text-sm outline-none focus:border-foreground disabled:opacity-60 dark:border-white/[.15] dark:bg-zinc-900"
      >
        {state.status === "loading" ? (
          <option value="">読み込み中…</option>
        ) : null}
        {state.status === "error" ? <option value="">—</option> : null}
        {state.status === "ready" && state.calendars.length === 0 ? (
          <option value="">書込可能なカレンダーがありません</option>
        ) : null}
        {state.status === "ready" && state.calendars.length > 0
          ? state.calendars.map((cal) => (
              <option key={cal.id} value={cal.id}>
                {cal.summary}
                {cal.primary ? "（メイン）" : ""}
              </option>
            ))
          : null}
      </select>
      {state.status === "error" ? (
        <p className="text-xs text-red-700 dark:text-red-300">{state.message}</p>
      ) : null}
    </div>
  );
}
