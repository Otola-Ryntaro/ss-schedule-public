// where: components/screenshot-composer.tsx
// what:  Orchestrating client component for the SS-009 main UI. Owns the file/text
//        state, calls /api/extract, validates the response with ExtractResponseSchema,
//        and either navigates to /preview or surfaces a friendly error + manual fallback.
// why:   The Server Component shell (`app/page.tsx`) has to stay server-side so it can
//        call `auth()`. All interactive state (selection, busy, error) lives here so
//        the page boundary stays clean and the inputs can share a single submit funnel.

"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { AuthStatusButton } from "@/components/auth-status-button";
import { ImageInput } from "@/components/image-input";
import { TextPastePanel } from "@/components/text-paste-panel";
import { ExtractResponseSchema } from "@/lib/schema";
import {
  EXTRACT_STORAGE_KEY,
  FRIENDLY_EXTRACT_ERROR,
} from "@/lib/storage-keys";

type Mode = "image" | "text";

type ComposerProps = {
  email: string;
  // Rendered on the server (Auth.js Server Action forms live in the parent).
  signOutSlot: ReactNode;
  reconnectSlot: ReactNode;
  // True when the server detected a dead Google refresh token (session.error).
  authStale: boolean;
};

export function ScreenshotComposer({
  email,
  signOutSlot,
  reconnectSlot,
  authStale,
}: ComposerProps) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<Mode | null>(null);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setFile(null);
    setText("");
    setError(null);
  }

  // H1: global paste. Lets the user hit Cmd/Ctrl+V (PC) or long-press → ペースト
  // (iPhone) anywhere on the page to drop a screenshot/text into the composer
  // without first clicking the right surface. We bail when an editable element
  // already owns the paste, otherwise prefer image items, then fall back to text.
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      if (busy) return;

      // If focus is inside a real editable element, let the native paste handle it.
      const target = e.target as HTMLElement | null;
      if (isEditableTarget(target)) return;

      const items = e.clipboardData?.items;
      if (!items) return;

      // Prefer the first image item — that is the screenshot path users actually want.
      for (const item of items) {
        if (item.kind === "file" && item.type.startsWith("image/")) {
          const blob = item.getAsFile();
          if (blob) {
            e.preventDefault();
            setFile(blob);
            setError(null);
            return;
          }
        }
      }

      // Fall back to plain text → text panel.
      const pastedText = e.clipboardData?.getData("text/plain");
      if (pastedText && pastedText.trim().length > 0) {
        e.preventDefault();
        setText((prev) => (prev ? `${prev}\n${pastedText}` : pastedText));
        setError(null);
      }
    }

    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [busy]);

  async function submit(mode: Mode) {
    if (busy) return;
    setBusy(mode);
    setError(null);

    try {
      let init: RequestInit;
      if (mode === "image") {
        if (!file) {
          setError("画像を選択してください");
          return;
        }
        init = buildImageRequest(file);
      } else {
        if (!text.trim()) {
          setError("テキストを入力してください");
          return;
        }
        init = buildTextRequest(text);
      }

      const res = await fetch("/api/extract", init);

      // Status-aware handling for the 4xx codes the API can emit before reaching
      // the friendly ok:false 200 path. /api/extract returns 401 (auth), 413
      // (file/text too large), and 429 (rate limit) with bodies that don't carry
      // a ok:false discriminator the schema can read, so we surface those here.
      if (!res.ok) {
        if (res.status === 401) {
          setError(
            "サインインの有効期限が切れました。もう一度サインインしてください。",
          );
          return;
        }
        if (res.status === 413) {
          setError("ファイルまたはテキストが大きすぎます。");
          return;
        }
        if (res.status === 429) {
          setError(
            "リクエストが多すぎます。少し待ってから再試行してください。",
          );
          return;
        }
        // Other non-OK statuses (400/403/etc.) fall through to the friendly default.
      }

      const json: unknown = await res.json().catch(() => null);
      const parsed = ExtractResponseSchema.safeParse(json);

      if (!parsed.success || !parsed.data.ok) {
        setError(
          parsed.success && !parsed.data.ok
            ? parsed.data.error
            : FRIENDLY_EXTRACT_ERROR,
        );
        return;
      }

      sessionStorage.setItem(EXTRACT_STORAGE_KEY, JSON.stringify(parsed.data));
      router.push("/preview");
    } catch {
      setError(FRIENDLY_EXTRACT_ERROR);
    } finally {
      setBusy(null);
    }
  }

  function handleManualFallback() {
    sessionStorage.removeItem(EXTRACT_STORAGE_KEY);
  }

  const imageBusy = busy === "image";
  const textBusy = busy === "text";
  const anyBusy = busy !== null;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
            SS_schedule
          </h1>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            画面のどこでも Cmd/Ctrl+V で画像 / テキストを貼り付けできます。
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 text-xs">
          <span className="text-zinc-600 dark:text-zinc-400">{email}</span>
          <AuthStatusButton
            reconnectSlot={reconnectSlot}
            initialStale={authStale}
          />
          {signOutSlot}
        </div>
      </header>

      {error ? (
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-900 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-100"
        >
          <p>{error}</p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={reset}
              className="inline-flex min-h-11 touch-manipulation items-center gap-2 rounded-full border border-red-300 px-4 py-2 text-sm font-medium text-red-900 hover:bg-red-100 dark:border-red-800 dark:text-red-100 dark:hover:bg-red-900/40"
            >
              もう一度試す
            </button>
            <a
              href="/preview?manual=1"
              onClick={handleManualFallback}
              className="inline-flex min-h-11 touch-manipulation items-center gap-2 rounded-full bg-red-900 px-4 py-2 text-sm font-medium text-white hover:bg-red-800 dark:bg-red-100 dark:text-red-900 dark:hover:bg-red-200"
            >
              手入力で続ける
            </a>
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <section className="flex flex-col gap-3 rounded-2xl border border-black/[.08] bg-white p-4 dark:border-white/[.08] dark:bg-zinc-950">
          <header>
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              画像から抽出
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              スクリーンショットを選ぶか、カメラで撮影してください。
            </p>
          </header>
          <ImageInput
            file={file}
            onFileChange={setFile}
            disabled={anyBusy}
          />
          <button
            type="button"
            onClick={() => submit("image")}
            disabled={!file || anyBusy}
            className="inline-flex min-h-11 touch-manipulation items-center justify-center gap-2 rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-[#383838] disabled:opacity-50 dark:hover:bg-[#ccc]"
          >
            {imageBusy ? <Loader2 className="size-4 animate-spin" /> : null}
            画像を解析する
          </button>
        </section>

        <TextPastePanel
          text={text}
          onTextChange={setText}
          onSubmit={() => submit("text")}
          disabled={anyBusy}
          busy={textBusy}
        />
      </div>
    </div>
  );
}

function buildImageRequest(file: File): RequestInit {
  const form = new FormData();
  // /api/extract reads the multipart field with key "file" (see app/api/extract/route.ts).
  form.append("file", file, file.name);
  return { method: "POST", body: form };
}

// True when the paste target is something the user is actively typing into. We
// must NOT preventDefault in that case; otherwise the native paste experience
// (caret, undo) breaks. contentEditable counts too — note isContentEditable is
// inherited so it flips on for any nested element inside an editable container.
function isEditableTarget(el: HTMLElement | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return el.isContentEditable;
}

function buildTextRequest(text: string): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  };
}
