"use client";

import { useState } from "react";

type SessionResponse =
  | { ok: true; email: string; expiresAt: number | null; token: string }
  | { ok: false; error: string };

type ExtensionConnectClientProps = {
  email: string;
  extensionId: string;
};

type ChromeRuntime = {
  sendMessage: (
    extensionId: string,
    message: unknown,
    callback?: (response: unknown) => void,
  ) => void;
  lastError?: { message?: string };
};

declare global {
  interface Window {
    chrome?: {
      runtime?: ChromeRuntime;
    };
  }
}

export function ExtensionConnectClient({
  email,
  extensionId,
}: ExtensionConnectClientProps) {
  const [status, setStatus] = useState<"idle" | "connecting" | "done" | "error">(
    "idle",
  );
  const [message, setMessage] = useState<string | null>(null);

  async function connect() {
    if (!extensionId) {
      setStatus("error");
      setMessage("extensionId が URL に含まれていません。");
      return;
    }
    if (!window.chrome?.runtime?.sendMessage) {
      setStatus("error");
      setMessage("Chrome 拡張機能の接続 API が見つかりません。Chrome で開いてください。");
      return;
    }

    setStatus("connecting");
    setMessage(null);
    try {
      const res = await fetch("/api/extension/session", {
        headers: { Accept: "application/json" },
      });
      const json = (await res.json().catch(() => null)) as SessionResponse | null;
      if (!res.ok || !json?.ok) {
        throw new Error(json?.ok === false ? json.error : "session unavailable");
      }

      await new Promise<void>((resolve, reject) => {
        window.chrome!.runtime!.sendMessage(
          extensionId,
          {
            type: "SS_SCHEDULE_CONNECT",
            payload: {
              baseUrl: window.location.origin,
              email: json.email,
              expiresAt: json.expiresAt,
              token: json.token,
            },
          },
          (response) => {
            const lastError = window.chrome?.runtime?.lastError;
            if (lastError?.message) {
              reject(new Error(lastError.message));
              return;
            }
            if (
              response &&
              typeof response === "object" &&
              "ok" in response &&
              (response as { ok?: unknown }).ok === true
            ) {
              resolve();
              return;
            }
            reject(new Error("extension did not accept the session"));
          },
        );
      });

      setStatus("done");
      setMessage("接続しました。サイドパネルに戻ってください。");
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "接続に失敗しました。");
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-black/[.08] bg-white p-4 dark:border-white/[.08] dark:bg-zinc-950">
      <div className="space-y-1">
        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
          {email}
        </p>
        <p className="break-all text-xs text-zinc-500 dark:text-zinc-400">
          Extension ID: {extensionId || "未指定"}
        </p>
      </div>

      <button
        type="button"
        onClick={connect}
        disabled={status === "connecting" || status === "done"}
        className="inline-flex items-center justify-center rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-[#383838] disabled:opacity-50 dark:hover:bg-[#ccc]"
      >
        {status === "connecting" ? "接続中..." : "拡張機能に接続"}
      </button>

      {message ? (
        <p
          role={status === "error" ? "alert" : "status"}
          className={
            status === "error"
              ? "text-sm text-red-700 dark:text-red-300"
              : "text-sm text-emerald-700 dark:text-emerald-300"
          }
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}
