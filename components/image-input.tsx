// where: components/image-input.tsx
// what:  Client-side image picker with three entry points (file picker, iPhone camera
//        capture, drag&drop) and a local object-URL preview.
// why:   The composer needs a reusable surface for image selection that stays close
//        to the input element so we can reset the file dialog and free preview URLs
//        without leaking memory across submissions.

"use client";

import { useEffect, useRef, useState } from "react";
import { ImageIcon, Camera, X } from "lucide-react";

type ImageInputProps = {
  file: File | null;
  onFileChange: (file: File | null) => void;
  disabled?: boolean;
};

export function ImageInput({ file, onFileChange, disabled }: ImageInputProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Re-create the preview URL whenever the file reference changes; revoke it on
  // cleanup to avoid leaking blob URLs between selections.
  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function handleFileSelect(next: File | null) {
    onFileChange(next);
    // Reset native inputs so picking the same file twice still fires onChange.
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (cameraInputRef.current) cameraInputRef.current.value = "";
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    if (disabled) return;
    const dropped = event.dataTransfer.files?.[0];
    if (dropped && dropped.type.startsWith("image/")) {
      handleFileSelect(dropped);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        className={[
          "flex min-h-56 flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed p-6 text-center transition-colors",
          isDragging
            ? "border-foreground bg-foreground/5"
            : "border-black/15 dark:border-white/15",
          disabled ? "pointer-events-none opacity-60" : "",
        ].join(" ")}
      >
        {previewUrl ? (
          <div className="relative w-full">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={previewUrl}
              alt="選択した画像のプレビュー"
              className="mx-auto max-h-72 rounded-lg object-contain"
            />
            <button
              type="button"
              onClick={() => handleFileSelect(null)}
              className="absolute right-2 top-2 inline-flex items-center justify-center rounded-full bg-black/60 p-1 text-white hover:bg-black/80"
              aria-label="画像をクリア"
            >
              <X className="size-4" />
            </button>
          </div>
        ) : (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            ここに画像をドラッグ&ドロップ、またはボタンから選択してください。
          </p>
        )}

        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            disabled={disabled}
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex min-h-11 touch-manipulation items-center gap-2 rounded-full border border-black/[.1] px-4 py-2 text-sm transition-colors hover:bg-black/[.04] disabled:opacity-50 dark:border-white/[.18] dark:hover:bg-[#1a1a1a]"
          >
            <ImageIcon className="size-4" />
            写真を選ぶ
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => cameraInputRef.current?.click()}
            className="inline-flex min-h-11 touch-manipulation items-center gap-2 rounded-full border border-black/[.1] px-4 py-2 text-sm transition-colors hover:bg-black/[.04] disabled:opacity-50 dark:border-white/[.18] dark:hover:bg-[#1a1a1a]"
          >
            <Camera className="size-4" />
            カメラで撮影
          </button>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => handleFileSelect(e.target.files?.[0] ?? null)}
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => handleFileSelect(e.target.files?.[0] ?? null)}
      />
    </div>
  );
}
