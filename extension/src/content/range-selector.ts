import { MIN_SELECTION_SIZE } from "../lib/constants";

type Point = { x: number; y: number };

const globalState = globalThis as typeof globalThis & {
  __ssScheduleRangeSelectorLoaded?: boolean;
  __ssScheduleRangeSelectorStart?: () => void;
  __ssScheduleRangeSelectorCleanup?: () => void;
};

globalState.__ssScheduleRangeSelectorStart = startSelection;

if (!globalState.__ssScheduleRangeSelectorLoaded) {
  globalState.__ssScheduleRangeSelectorLoaded = true;
  chrome.runtime.onMessage.addListener((message: any) => {
    if (message?.type === "SS_START_RANGE_SELECTION") {
      globalState.__ssScheduleRangeSelectorStart?.();
    }
  });
}

function startSelection() {
  globalState.__ssScheduleRangeSelectorCleanup?.();

  const overlay = document.createElement("div");
  overlay.style.cssText = [
    "position:fixed",
    "inset:0",
    "z-index:2147483647",
    "cursor:crosshair",
    "background:rgba(9,9,11,0.18)",
    "user-select:none",
  ].join(";");

  const label = document.createElement("div");
  label.textContent = "ドラッグして範囲指定 / Escでキャンセル";
  label.style.cssText = [
    "position:fixed",
    "top:12px",
    "left:50%",
    "transform:translateX(-50%)",
    "padding:8px 12px",
    "border-radius:999px",
    "background:rgba(24,24,27,0.92)",
    "color:white",
    "font:12px system-ui,sans-serif",
    "box-shadow:0 8px 24px rgba(0,0,0,0.24)",
  ].join(";");
  overlay.appendChild(label);

  const box = document.createElement("div");
  box.style.cssText = [
    "position:fixed",
    "display:none",
    "border:2px solid #22c55e",
    "background:rgba(34,197,94,0.16)",
    "box-shadow:0 0 0 9999px rgba(0,0,0,0.28)",
    "pointer-events:none",
  ].join(";");
  overlay.appendChild(box);
  document.documentElement.appendChild(overlay);

  let start: Point | null = null;
  let current: Point | null = null;

  function rectFromPoints(a: Point, b: Point) {
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    return {
      x,
      y,
      width: Math.abs(a.x - b.x),
      height: Math.abs(a.y - b.y),
    };
  }

  function render() {
    if (!start || !current) return;
    const rect = rectFromPoints(start, current);
    box.style.display = "block";
    box.style.left = `${rect.x}px`;
    box.style.top = `${rect.y}px`;
    box.style.width = `${rect.width}px`;
    box.style.height = `${rect.height}px`;
  }

  function onPointerDown(event: PointerEvent) {
    event.preventDefault();
    start = { x: event.clientX, y: event.clientY };
    current = start;
    render();
  }

  function onPointerMove(event: PointerEvent) {
    if (!start) return;
    event.preventDefault();
    current = { x: event.clientX, y: event.clientY };
    render();
  }

  function onPointerUp(event: PointerEvent) {
    if (!start) return;
    current = { x: event.clientX, y: event.clientY };
    const rect = rectFromPoints(start, current);
    cleanup();
    if (rect.width < MIN_SELECTION_SIZE || rect.height < MIN_SELECTION_SIZE) {
      chrome.runtime.sendMessage({
        type: "SS_RANGE_CANCELLED",
        error: "選択範囲が小さすぎます。",
      });
      return;
    }
    chrome.runtime.sendMessage({
      type: "SS_RANGE_SELECTED",
      payload: { rect, dpr: window.devicePixelRatio || 1 },
    });
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key !== "Escape") return;
    cleanup();
    chrome.runtime.sendMessage({
      type: "SS_RANGE_CANCELLED",
      error: "キャンセルしました。",
    });
  }

  function cleanup() {
    overlay.removeEventListener("pointerdown", onPointerDown);
    window.removeEventListener("pointermove", onPointerMove, true);
    window.removeEventListener("pointerup", onPointerUp, true);
    window.removeEventListener("keydown", onKeyDown, true);
    overlay.remove();
    if (globalState.__ssScheduleRangeSelectorCleanup === cleanup) {
      globalState.__ssScheduleRangeSelectorCleanup = undefined;
    }
  }

  overlay.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointermove", onPointerMove, true);
  window.addEventListener("pointerup", onPointerUp, true);
  window.addEventListener("keydown", onKeyDown, true);
  globalState.__ssScheduleRangeSelectorCleanup = cleanup;
}
