// where: lib/storage-keys.ts
// what:  Shared sessionStorage keys / user-facing error strings.
// why:   SS-009 writes the extract result here; SS-010 reads it. Single source
//        of truth prevents copy-paste drift if either side renames the key.

export const EXTRACT_STORAGE_KEY = "ss-schedule.extract";
export const FRIENDLY_EXTRACT_ERROR =
  "読み取れませんでした、もう一度試すか手動で登録してください";
