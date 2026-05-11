// where: components/text-paste-panel.tsx
// what:  Side panel for pasting raw event text. Stacks below the image input on
//        narrow viewports and sits to the right on desktop via the parent layout.
// why:   Keeping the textarea and submit button colocated makes it easy for the
//        composer to drive both states (text + busy) from one place.

"use client";

import { Loader2 } from "lucide-react";

type TextPastePanelProps = {
  text: string;
  onTextChange: (next: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  busy?: boolean;
};

export function TextPastePanel({
  text,
  onTextChange,
  onSubmit,
  disabled,
  busy,
}: TextPastePanelProps) {
  const canSubmit = !disabled && (text.trim().length > 0);

  return (
    <section className="flex h-full flex-col gap-3 rounded-2xl border border-black/[.08] bg-white p-4 dark:border-white/[.08] dark:bg-zinc-950">
      <header>
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          テキストから抽出
        </h2>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          メールやメッセージの本文をそのまま貼り付けてください。
        </p>
      </header>

      <textarea
        value={text}
        onChange={(e) => onTextChange(e.target.value)}
        disabled={disabled}
        placeholder="予定情報を含むテキストを貼り付け…"
        className="min-h-40 w-full resize-y rounded-xl border border-black/[.1] bg-white p-3 text-sm leading-6 outline-none placeholder:text-zinc-400 focus:border-foreground disabled:opacity-60 dark:border-white/[.15] dark:bg-zinc-900 dark:placeholder:text-zinc-500"
      />

      <button
        type="button"
        onClick={onSubmit}
        disabled={!canSubmit || busy}
        className="inline-flex min-h-11 touch-manipulation items-center justify-center gap-2 rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-[#383838] disabled:opacity-50 dark:hover:bg-[#ccc]"
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : null}
        解析する
      </button>
    </section>
  );
}
