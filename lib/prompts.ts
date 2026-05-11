// where: lib/prompts.ts
// what:  Prompt templates for Gemini 1-event extraction (image / text inputs).
// why:   Centralizing prompts makes them testable and tunable without touching SDK code.
//        Gemini owns natural-language interpretation (relative dates / kanji times → strict format).
//        This layer (lib/datetime.ts) only assembles ISO strings and applies boundary corrections.

import { formatInTimeZone } from "date-fns-tz";

const TZ = "Asia/Tokyo";

// Build the JST "now" reference embedded in every prompt. Gemini uses this to resolve
// relative expressions like 「明日」「来週金曜」 deterministically.
function buildNowReference(now: Date): string {
  const jstString = formatInTimeZone(now, TZ, "yyyy-MM-dd HH:mm");
  return `現在の日時は ${now.toISOString()} (JST = ${jstString}) です。`;
}

// Shared instruction body. Both image and text prompts append this so the output schema
// is enforced identically. Format rules below are duplicated in the zod regex (lib/schema.ts);
// keep them in sync with GeminiRawOutputSchema.
function buildInstructions(): string {
  return [
    "あなたは日本語の予定メッセージ／スクリーンショットから 1 件のイベントを抽出するアシスタントです。",
    "出力は厳密な JSON のみ。前置き・解説・コードフェンスは禁止です。",
    "",
    "【出力フィールド】",
    "- title: 予定のタイトル（必須・空文字禁止）",
    "- startDate / endDate: 'YYYY-MM-DD' 形式の文字列、または null",
    "- startTime / endTime: 'HH:mm' (24h, 0 埋め) 形式の文字列、または null",
    "- isAllDay: 終日なら true、時刻指定があるなら false",
    "- location: 場所文字列または null",
    "- url: URL 文字列または null",
    "- description: 補足文字列または null",
    "- multipleDetected: 候補が複数あれば true（先頭 1 件のみ採用してその上で true）",
    "",
    "【厳守する形式ルール】",
    "- 日付はスラッシュ区切り (2026/5/3) や和暦 (2026年5月3日) を禁止し必ず 'YYYY-MM-DD'。",
    "- 時刻は '午後3時' '14時' '2pm' を禁止し必ず 'HH:mm' (例: '14:00')。",
    "- 「明日」「明後日」「来週金曜」などは上記の現在日時を基準に 'YYYY-MM-DD' へ解釈。",
    "- 年なし表記は現在の年を採用。ただし結果が現在より過去になるなら翌年に補正。",
    "- 終日と判断したら isAllDay: true、startTime/endTime は null。",
    "- 解釈不能なフィールドは null（推測しない）。",
    "- 候補が複数検出されても先頭の 1 件のみ採用し multipleDetected: true。",
    "",
    "【役割分担】ISO 文字列の組み立てや終了時刻の補正はアプリ側 (lib/datetime.ts) が担当します。",
    "あなたは strict format への正規化のみを行い、ISO や +09:00 オフセットは付けないでください。",
  ].join("\n");
}

// Prompt for text input. The user-supplied text is appended verbatim.
export function buildTextPrompt(userText: string, now: Date): string {
  return [
    buildNowReference(now),
    "",
    buildInstructions(),
    "",
    "【入力テキスト】",
    userText,
  ].join("\n");
}

// Prompt for image input. The screenshot itself is sent as inlineData;
// this string is the textual instruction that accompanies it.
export function buildImagePrompt(now: Date): string {
  return [
    buildNowReference(now),
    "",
    buildInstructions(),
    "",
    "添付された画像（スクリーンショット）から 1 件のイベントを抽出してください。",
  ].join("\n");
}
