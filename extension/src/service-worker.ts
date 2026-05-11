import { DEFAULT_BASE_URL, SESSION_STORAGE_KEY } from "./lib/constants";
import type { ExtensionSession } from "./lib/types";

type PendingCapture = {
  reject: (message: string) => void;
  resolve: (value: Record<string, unknown>) => void;
  timer: ReturnType<typeof setTimeout>;
  windowId: number;
};

const pendingCaptures = new Map<number, PendingCapture>();

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.action.onClicked.addListener(async (tab: any) => {
  if (tab?.windowId !== undefined) {
    await chrome.sidePanel.open({ windowId: tab.windowId });
  }
});

chrome.runtime.onMessageExternal.addListener(
  (message: any, sender: any, sendResponse: (response: unknown) => void) => {
    if (message?.type !== "SS_SCHEDULE_CONNECT") return false;
    const origin = sender?.origin ?? (sender?.url ? new URL(sender.url).origin : "");
    if (origin !== DEFAULT_BASE_URL) {
      sendResponse({ ok: false, error: "invalid sender" });
      return true;
    }

    const payload = message.payload;
    if (
      !payload ||
      typeof payload.token !== "string" ||
      typeof payload.email !== "string"
    ) {
      sendResponse({ ok: false, error: "invalid payload" });
      return true;
    }

    const session: ExtensionSession = {
      baseUrl: DEFAULT_BASE_URL,
      connectedAt: Date.now(),
      email: payload.email,
      expiresAt:
        typeof payload.expiresAt === "number" ? payload.expiresAt : null,
      token: payload.token,
    };
    chrome.storage.local.set({ [SESSION_STORAGE_KEY]: session }, () => {
      sendResponse({ ok: true });
    });
    return true;
  },
);

chrome.runtime.onMessage.addListener(
  (message: any, sender: any, sendResponse: (response: unknown) => void) => {
    if (message?.type === "SS_START_RANGE_SELECTION") {
      startRangeSelection(sendResponse);
      return true;
    }

    if (message?.type === "SS_RANGE_SELECTED") {
      finishRangeSelection(sender.tab?.id, message.payload);
      sendResponse({ ok: true });
      return true;
    }

    if (message?.type === "SS_RANGE_CANCELLED") {
      cancelRangeSelection(sender.tab?.id, message.error ?? "キャンセルしました。");
      sendResponse({ ok: true });
      return true;
    }

    return false;
  },
);

async function startRangeSelection(sendResponse: (response: unknown) => void) {
  try {
    const tab = await getActivePageTab();
    if (!tab?.id || tab.windowId === undefined) {
      throw new Error("現在のタブを取得できませんでした。");
    }
    if (typeof tab.url === "string" && !isInjectableUrl(tab.url)) {
      throw new Error("このページではスクショ範囲指定を使えません。");
    }
    clearPendingCapture(tab.id);
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["range-selector.js"],
      });
    } catch (err) {
      const detail = chrome.runtime.lastError?.message;
      throw new Error(
        detail
          ? `このページではスクショ範囲指定を使えません: ${detail}`
          : err instanceof Error
            ? `このページではスクショ範囲指定を使えません: ${err.message}`
            : "このページではスクショ範囲指定を使えません。",
      );
    }

    const result = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = globalThis.setTimeout(() => {
        pendingCaptures.delete(tab.id);
        reject(new Error("範囲指定がタイムアウトしました。"));
      }, 60_000);
      pendingCaptures.set(tab.id, {
        reject: (message) => reject(new Error(message)),
        resolve,
        timer,
        windowId: tab.windowId,
      });
      chrome.tabs.sendMessage(tab.id, { type: "SS_START_RANGE_SELECTION" });
    });
    sendResponse({ ok: true, ...result });
  } catch (err) {
    sendResponse({
      ok: false,
      error: err instanceof Error ? err.message : "スクショを開始できませんでした。",
    });
  }
}

async function getActivePageTab(): Promise<any | null> {
  const lastFocused = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true,
  });
  if (lastFocused[0]?.id) return lastFocused[0];

  const current = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });
  if (current[0]?.id) return current[0];

  const allActive = await chrome.tabs.query({ active: true });
  return allActive.find((tab: any) => tab?.id && tab?.windowId !== undefined) ?? null;
}

function clearPendingCapture(tabId: number) {
  const pending = pendingCaptures.get(tabId);
  if (!pending) return;
  pendingCaptures.delete(tabId);
  clearTimeout(pending.timer);
}

async function finishRangeSelection(tabId: number | undefined, payload: unknown) {
  if (!tabId) return;
  const pending = pendingCaptures.get(tabId);
  if (!pending) return;
  pendingCaptures.delete(tabId);
  clearTimeout(pending.timer);
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(pending.windowId, {
      format: "png",
    });
    pending.resolve({ dataUrl, ...(payload as Record<string, unknown>) });
  } catch (err) {
    pending.reject(err instanceof Error ? err.message : "スクショ撮影に失敗しました。");
  }
}

function cancelRangeSelection(tabId: number | undefined, message: string) {
  if (!tabId) return;
  const pending = pendingCaptures.get(tabId);
  if (!pending) return;
  pendingCaptures.delete(tabId);
  clearTimeout(pending.timer);
  pending.reject(message);
}

function isInjectableUrl(url: string): boolean {
  return /^https?:\/\//.test(url);
}
