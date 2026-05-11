import type { ExtractedEvent } from "@/lib/schema";

export type ExtensionSession = {
  baseUrl: string;
  connectedAt: number;
  email: string;
  expiresAt: number | null;
  token: string;
};

export type CaptureSelectionResult = {
  dataUrl: string;
  dpr: number;
  rect: {
    height: number;
    width: number;
    x: number;
    y: number;
  };
};

export type PanelMode = "screenshot" | "text";

export type EventFormState = {
  title: string;
  startLocal: string;
  endLocal: string;
  isAllDay: boolean;
  location: string;
  url: string;
  description: string;
};

export type ExtractedState = {
  event: ExtractedEvent;
  multipleDetected: boolean;
  pastDateWarning: boolean;
};
