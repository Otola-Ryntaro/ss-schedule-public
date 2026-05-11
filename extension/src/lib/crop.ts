import type { CaptureSelectionResult } from "./types";

export function getCropRect(
  selection: CaptureSelectionResult,
  imageWidth: number,
  imageHeight: number,
): { sx: number; sy: number; sw: number; sh: number } {
  const sx = Math.max(0, Math.round(selection.rect.x * selection.dpr));
  const sy = Math.max(0, Math.round(selection.rect.y * selection.dpr));
  const sw = Math.min(
    imageWidth - sx,
    Math.round(selection.rect.width * selection.dpr),
  );
  const sh = Math.min(
    imageHeight - sy,
    Math.round(selection.rect.height * selection.dpr),
  );
  return { sx, sy, sw: Math.max(0, sw), sh: Math.max(0, sh) };
}

export async function cropSelectionToPngBlob(
  selection: CaptureSelectionResult,
): Promise<Blob> {
  const image = await loadImage(selection.dataUrl);
  const { sx, sy, sw, sh } = getCropRect(selection, image.width, image.height);
  if (sw <= 0 || sh <= 0) {
    throw new Error("選択範囲が小さすぎます。");
  }

  const canvas = document.createElement("canvas");
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("画像処理に失敗しました。");
  ctx.drawImage(image, sx, sy, sw, sh, 0, 0, sw, sh);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("画像処理に失敗しました。"));
    }, "image/png");
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("スクリーンショットを読み込めませんでした。"));
    image.src = src;
  });
}
