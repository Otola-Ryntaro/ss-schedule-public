// where: components/auth-status-button.tsx
// what:  Header control that lets the user verify the Google connection on demand and,
//        when it is stale, surface a one-tap re-connect path.
// why:   The Google refresh token can expire (every 7 days while the OAuth app is in
//        "Testing" status) while the Auth.js session cookie is still valid — so the app
//        looks signed in but every Calendar API call 401s with no recovery path. This
//        button probes /api/auth/status and, on failure (or when the server already
//        flagged session.error via `initialStale`), shows the ReconnectForm.

"use client";

import { useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw } from "lucide-react";

type Status = "idle" | "checking" | "ok" | "stale";

type Props = {
  // Server Action form (<ReconnectForm />) rendered by the server parent.
  reconnectSlot: ReactNode;
  // True when the server already detected a refresh failure (session.error).
  initialStale?: boolean;
};

export function AuthStatusButton({ reconnectSlot, initialStale = false }: Props) {
  const [status, setStatus] = useState<Status>(initialStale ? "stale" : "idle");

  async function check() {
    setStatus("checking");
    try {
      const res = await fetch("/api/auth/status", { cache: "no-store" });
      const json: unknown = await res.json().catch(() => null);
      const ok =
        res.ok &&
        typeof json === "object" &&
        json !== null &&
        (json as { ok?: unknown }).ok === true;
      setStatus(ok ? "ok" : "stale");
    } catch {
      // Network failure — treat as "needs attention" rather than silently passing.
      setStatus("stale");
    }
  }

  if (status === "stale") {
    return (
      <div className="flex items-center gap-2">
        <span
          role="status"
          className="inline-flex items-center gap-1 text-red-600 dark:text-red-400"
        >
          <AlertTriangle className="size-3.5" />
          要再接続
        </span>
        {reconnectSlot}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={check}
      disabled={status === "checking"}
      className="inline-flex min-h-11 touch-manipulation items-center gap-1 rounded-full border border-black/[.08] px-3 py-1.5 text-xs transition-colors hover:bg-black/[.04] disabled:opacity-50 dark:border-white/[.145] dark:hover:bg-[#1a1a1a]"
    >
      {status === "checking" ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : status === "ok" ? (
        <CheckCircle2 className="size-3.5 text-green-600 dark:text-green-400" />
      ) : (
        <RefreshCw className="size-3.5" />
      )}
      {status === "ok" ? "接続OK" : "接続を確認"}
    </button>
  );
}
