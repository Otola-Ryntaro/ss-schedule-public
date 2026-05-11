import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_BASE_URL, SESSION_STORAGE_KEY } from "@/extension/src/lib/constants";

type ExternalListener = (
  message: unknown,
  sender: { origin?: string; url?: string },
  sendResponse: (response: unknown) => void,
) => boolean;

const storageSetMock = vi.fn((_value: unknown, callback?: () => void) => {
  callback?.();
});
let externalListener: ExternalListener | null = null;

beforeEach(() => {
  vi.resetModules();
  storageSetMock.mockClear();
  externalListener = null;
  vi.stubGlobal("chrome", {
    action: {
      onClicked: { addListener: vi.fn() },
    },
    runtime: {
      onInstalled: { addListener: vi.fn() },
      onMessage: { addListener: vi.fn() },
      onMessageExternal: {
        addListener: vi.fn((listener: ExternalListener) => {
          externalListener = listener;
        }),
      },
    },
    sidePanel: {
      setPanelBehavior: vi.fn(),
      open: vi.fn(),
    },
    storage: {
      local: {
        set: storageSetMock,
      },
    },
  });
});

describe("extension service worker session bridge", () => {
  it("stores the fixed app origin even when the payload contains another baseUrl", async () => {
    await import("@/extension/src/service-worker");
    expect(externalListener).toBeTypeOf("function");

    const responses: unknown[] = [];
    const accepted = externalListener!(
      {
        type: "SS_SCHEDULE_CONNECT",
        payload: {
          baseUrl: "https://evil.example.com",
          email: "u@example.com",
          token: "encrypted-session-token",
        },
      },
      { origin: DEFAULT_BASE_URL },
      (response) => responses.push(response),
    );

    expect(accepted).toBe(true);
    expect(responses).toEqual([{ ok: true }]);
    expect(storageSetMock).toHaveBeenCalledWith(
      {
        [SESSION_STORAGE_KEY]: expect.objectContaining({
          baseUrl: DEFAULT_BASE_URL,
          email: "u@example.com",
          token: "encrypted-session-token",
        }),
      },
      expect.any(Function),
    );
  });
});
