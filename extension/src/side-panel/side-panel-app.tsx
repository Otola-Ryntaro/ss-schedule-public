import { useEffect, useMemo, useState } from "react";
import {
  type CalendarListEntry,
  type ConflictEvent,
  type ExtractedEvent,
} from "@/lib/schema";
import { DEFAULT_BASE_URL, SESSION_STORAGE_KEY } from "../lib/constants";
import { ConflictError, ExtensionApiClient } from "../lib/api-client";
import { cropSelectionToPngBlob } from "../lib/crop";
import { emptyForm, eventToForm, formToEvent } from "../lib/event-form";
import { clearStoredSession, getStoredSession } from "../lib/storage";
import type {
  CaptureSelectionResult,
  EventFormState,
  ExtensionSession,
  ExtractedState,
  PanelMode,
} from "../lib/types";

type SubmitState =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "success"; htmlLink: string }
  | { status: "error"; message: string }
  | { status: "conflict"; conflicts: ConflictEvent[] };

export function SidePanelApp() {
  const [session, setSession] = useState<ExtensionSession | null>(null);
  const [mode, setMode] = useState<PanelMode>("screenshot");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [extracted, setExtracted] = useState<ExtractedState | null>(null);
  const [form, setForm] = useState<EventFormState>(() => emptyForm());
  const [calendars, setCalendars] = useState<CalendarListEntry[]>([]);
  const [calendarId, setCalendarId] = useState("");
  const [submit, setSubmit] = useState<SubmitState>({ status: "idle" });

  const api = useMemo(
    () => (session ? new ExtensionApiClient(session) : null),
    [session],
  );

  useEffect(() => {
    getStoredSession().then(setSession);
    const listener = (
      changes: Record<string, { newValue?: ExtensionSession }>,
      areaName: string,
    ) => {
      if (areaName === "local" && SESSION_STORAGE_KEY in changes) {
        setSession(changes[SESSION_STORAGE_KEY].newValue ?? null);
      }
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []);

  useEffect(() => {
    if (!api || !extracted) return;
    let cancelled = false;
    api
      .listCalendars()
      .then((items) => {
        if (cancelled) return;
        setCalendars(items);
        const primary = items.find((item) => item.primary) ?? items[0];
        setCalendarId(primary?.id ?? "");
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "カレンダー一覧の取得に失敗しました。");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [api, extracted]);

  async function connect() {
    const url = `${DEFAULT_BASE_URL}/extension/connect?extensionId=${chrome.runtime.id}`;
    await chrome.tabs.create({ url });
  }

  async function disconnect() {
    await clearStoredSession();
    setSession(null);
    resetResult();
  }

  function resetResult() {
    setExtracted(null);
    setForm(emptyForm());
    setCalendars([]);
    setCalendarId("");
    setSubmit({ status: "idle" });
    setError(null);
  }

  function acceptExtracted(result: ExtractedState) {
    setExtracted(result);
    setForm(eventToForm(result.event));
    setSubmit({ status: "idle" });
  }

  async function runTextExtract() {
    if (!api) {
      setError("Webで再接続してください。");
      return;
    }
    if (!text.trim()) {
      setError("テキストを入力してください。");
      return;
    }
    setBusy("text");
    setError(null);
    try {
      const result = await api.extractText(text);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      acceptExtracted(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "解析に失敗しました。");
    } finally {
      setBusy(null);
    }
  }

  async function runScreenshotExtract() {
    if (!api) {
      setError("Webで再接続してください。");
      return;
    }
    setBusy("screenshot");
    setError(null);
    try {
      const response = await chrome.runtime.sendMessage({
        type: "SS_START_RANGE_SELECTION",
      });
      if (!response?.ok) {
        throw new Error(response?.error ?? "スクショ範囲指定に失敗しました。");
      }
      const blob = await cropSelectionToPngBlob(response as CaptureSelectionResult);
      const result = await api.extractImage(blob);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      acceptExtracted(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "スクショ解析に失敗しました。");
    } finally {
      setBusy(null);
    }
  }

  async function submitEvent(options?: { confirmConflicts?: boolean }) {
    if (!api) {
      setError("Webで再接続してください。");
      return;
    }
    const built = formToEvent(form);
    if (!built.ok) {
      setSubmit({ status: "error", message: built.error });
      return;
    }
    if (!calendarId) {
      setSubmit({ status: "error", message: "書込先カレンダーを選択してください。" });
      return;
    }

    setSubmit({ status: "submitting" });
    try {
      const result = await api.insertEvent(calendarId, built.event, {
        confirmConflicts: options?.confirmConflicts ?? false,
      });
      setSubmit({ status: "success", htmlLink: result.htmlLink });
    } catch (err) {
      // SS-014: ConflictError surfaces overlapping events for user confirmation.
      if (err instanceof ConflictError) {
        setSubmit({ status: "conflict", conflicts: err.conflicts });
        return;
      }
      setSubmit({
        status: "error",
        message: err instanceof Error ? err.message : "登録に失敗しました。",
      });
    }
  }

  const canSubmit =
    !!extracted &&
    !!calendarId &&
    !!form.title.trim() &&
    !!form.startLocal &&
    !!form.endLocal &&
    submit.status !== "submitting";

  return (
    <main className="panel">
      <header className="topbar">
        <div>
          <h1>SS_schedule</h1>
          <p>ページから予定を抽出して登録</p>
        </div>
        {session ? (
          <button className="ghostButton" type="button" onClick={disconnect}>
            解除
          </button>
        ) : null}
      </header>

      {!session ? (
        <section className="connectBox">
          <h2>Web ログインと接続</h2>
          <p>
            既存の SS_schedule に Google ログインしてから、拡張機能へ接続してください。
          </p>
          <button className="primaryButton" type="button" onClick={connect}>
            Webでログインして接続
          </button>
        </section>
      ) : (
        <>
          <section className="accountStrip">
            <span>{session.email}</span>
            <button type="button" onClick={connect}>
              再接続
            </button>
          </section>

          <nav className="tabs" aria-label="入力方式">
            <button
              className={mode === "screenshot" ? "active" : ""}
              type="button"
              onClick={() => setMode("screenshot")}
            >
              スクショ
            </button>
            <button
              className={mode === "text" ? "active" : ""}
              type="button"
              onClick={() => setMode("text")}
            >
              文章入力
            </button>
          </nav>

          {error ? (
            <div className="errorBox" role="alert">
              {error}
            </div>
          ) : null}

          {mode === "screenshot" ? (
            <section className="inputBox">
              <p>表示中タブで範囲をドラッグ指定し、その範囲だけを解析します。</p>
              <button
                className="primaryButton"
                type="button"
                disabled={!!busy}
                onClick={runScreenshotExtract}
              >
                {busy === "screenshot" ? "範囲指定中..." : "スクショ"}
              </button>
            </section>
          ) : (
            <section className="inputBox">
              <textarea
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder="例: 明日14時から渋谷で歯医者"
                rows={7}
              />
              <button
                className="primaryButton"
                type="button"
                disabled={!!busy || !text.trim()}
                onClick={runTextExtract}
              >
                {busy === "text" ? "解析中..." : "解析"}
              </button>
            </section>
          )}

          {extracted ? (
            <PreviewEditor
              calendars={calendars}
              canSubmit={canSubmit}
              calendarId={calendarId}
              form={form}
              multipleDetected={extracted.multipleDetected}
              onCalendarIdChange={setCalendarId}
              onFormChange={setForm}
              onReset={resetResult}
              onSubmit={() => submitEvent()}
              onConfirmConflict={() => submitEvent({ confirmConflicts: true })}
              onDismissConflict={() => setSubmit({ status: "idle" })}
              pastDateWarning={extracted.pastDateWarning}
              submit={submit}
            />
          ) : null}
        </>
      )}
    </main>
  );
}

function PreviewEditor({
  calendars,
  canSubmit,
  calendarId,
  form,
  multipleDetected,
  onCalendarIdChange,
  onFormChange,
  onReset,
  onSubmit,
  onConfirmConflict,
  onDismissConflict,
  pastDateWarning,
  submit,
}: {
  calendars: CalendarListEntry[];
  canSubmit: boolean;
  calendarId: string;
  form: EventFormState;
  multipleDetected: boolean;
  onCalendarIdChange: (value: string) => void;
  onFormChange: (value: EventFormState) => void;
  onReset: () => void;
  onSubmit: () => void;
  onConfirmConflict: () => void;
  onDismissConflict: () => void;
  pastDateWarning: boolean;
  submit: SubmitState;
}) {
  const inputType = form.isAllDay ? "date" : "datetime-local";

  function patch(update: Partial<EventFormState>) {
    onFormChange({ ...form, ...update });
  }

  return (
    <section className="previewBox">
      <div className="previewHeader">
        <h2>予定の確認・編集</h2>
        <button type="button" onClick={onReset}>
          クリア
        </button>
      </div>

      {multipleDetected ? <p className="notice">複数候補があります。先頭のみ表示しています。</p> : null}
      {pastDateWarning ? <p className="notice">過去の日付が指定されています。</p> : null}

      <label>
        タイトル
        <input
          value={form.title}
          onChange={(event) => patch({ title: event.target.value })}
        />
      </label>

      <label className="checkRow">
        <input
          type="checkbox"
          checked={form.isAllDay}
          onChange={(event) => {
            const isAllDay = event.target.checked;
            patch({
              isAllDay,
              startLocal: isAllDay
                ? form.startLocal.slice(0, 10)
                : form.startLocal.length === 10
                  ? `${form.startLocal}T00:00`
                  : form.startLocal,
              endLocal: isAllDay
                ? form.endLocal.slice(0, 10)
                : form.endLocal.length === 10
                  ? `${form.endLocal}T01:00`
                  : form.endLocal,
            });
          }}
        />
        終日イベント
      </label>

      <div className="twoCols">
        <label>
          開始
          <input
            type={inputType}
            value={form.startLocal}
            onChange={(event) => patch({ startLocal: event.target.value })}
          />
        </label>
        <label>
          終了
          <input
            type={inputType}
            value={form.endLocal}
            onChange={(event) => patch({ endLocal: event.target.value })}
          />
        </label>
      </div>

      <label>
        場所
        <input
          value={form.location}
          onChange={(event) => patch({ location: event.target.value })}
        />
      </label>

      <label>
        URL
        <input
          type="url"
          value={form.url}
          onChange={(event) => patch({ url: event.target.value })}
        />
      </label>

      <label>
        メモ
        <textarea
          value={form.description}
          onChange={(event) => patch({ description: event.target.value })}
          rows={3}
        />
      </label>

      <label>
        書込先カレンダー
        <select
          value={calendarId}
          onChange={(event) => onCalendarIdChange(event.target.value)}
        >
          {calendars.length === 0 ? <option value="">読み込み中...</option> : null}
          {calendars.map((calendar) => (
            <option key={calendar.id} value={calendar.id}>
              {calendar.summary}
              {calendar.primary ? "（メイン）" : ""}
            </option>
          ))}
        </select>
      </label>

      {submit.status === "conflict" ? (
        <div className="errorBox" role="alert">
          <p>同じ時間帯に既存の予定があります。</p>
          <ul>
            {submit.conflicts.map((c) => (
              <li key={c.id}>
                {c.title} — {formatConflictRange(c)}
              </li>
            ))}
          </ul>
          <p>それでも登録しますか？</p>
          <div className="conflictActions">
            <button type="button" onClick={onConfirmConflict}>
              それでも登録
            </button>
            <button type="button" onClick={onDismissConflict}>
              戻る
            </button>
          </div>
        </div>
      ) : null}
      {submit.status === "error" ? (
        <p className="errorText" role="alert">
          {submit.message}
        </p>
      ) : null}
      {submit.status === "success" ? (
        <a className="successLink" href={submit.htmlLink} target="_blank" rel="noreferrer">
          Google カレンダーで開く
        </a>
      ) : null}

      <button
        className="primaryButton"
        type="button"
        disabled={!canSubmit}
        onClick={onSubmit}
      >
        {submit.status === "submitting" ? "登録中..." : "カレンダーに登録"}
      </button>
    </section>
  );
}

// SS-014: short "MM/DD HH:mm〜HH:mm" or "MM/DD 終日" rendering. The ISO carries
// +09:00, so string-slicing avoids TZ-aware date math (matches /preview style).
function formatConflictRange(conflict: ConflictEvent): string {
  if (conflict.isAllDay) {
    return `${conflict.startISO.slice(5, 10).replace("-", "/")} 終日`;
  }
  const date = conflict.startISO.slice(5, 10).replace("-", "/");
  const startTime = conflict.startISO.slice(11, 16);
  const endTime = conflict.endISO.slice(11, 16);
  return `${date} ${startTime}〜${endTime}`;
}
