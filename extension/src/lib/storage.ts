import { SESSION_STORAGE_KEY } from "./constants";
import type { ExtensionSession } from "./types";

export async function getStoredSession(): Promise<ExtensionSession | null> {
  const result = await chrome.storage.local.get(SESSION_STORAGE_KEY);
  const session = result?.[SESSION_STORAGE_KEY];
  if (
    session &&
    typeof session === "object" &&
    typeof session.token === "string" &&
    typeof session.email === "string" &&
    typeof session.baseUrl === "string"
  ) {
    return session as ExtensionSession;
  }
  return null;
}

export async function setStoredSession(session: ExtensionSession): Promise<void> {
  await chrome.storage.local.set({ [SESSION_STORAGE_KEY]: session });
}

export async function clearStoredSession(): Promise<void> {
  await chrome.storage.local.remove(SESSION_STORAGE_KEY);
}
