// where: __tests__/gemini.test.ts
// what:  TDD tests for parseGeminiResponse, extractFromImage, extractFromText.
// why:   parseGeminiResponse is a pure JSON->schema parser; extract* wraps the SDK call.
//        We mock @google/genai so tests stay hermetic (no real API calls).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Mock @google/genai before importing lib/gemini ---
const generateContentMock = vi.fn();

vi.mock("@google/genai", () => {
  // Minimal Type enum subset used by our code (zod-to-json-schema generates raw JSON Schema,
  // so we don't actually rely on Type in tests, but the SDK exports it).
  class FakeGoogleGenAI {
    models = { generateContent: generateContentMock };
    constructor(_opts?: unknown) {}
  }
  return {
    GoogleGenAI: FakeGoogleGenAI,
    Type: {
      OBJECT: "OBJECT",
      STRING: "STRING",
      ARRAY: "ARRAY",
      INTEGER: "INTEGER",
      BOOLEAN: "BOOLEAN",
      NUMBER: "NUMBER",
    },
  };
});

import {
  extractFromImage,
  extractFromText,
  parseGeminiResponse,
} from "@/lib/gemini";

const NOW = new Date("2026-05-02T10:00:00+09:00");

const validRaw = {
  title: "歯医者",
  startDate: "2026-05-03",
  startTime: "14:00",
  endDate: null,
  endTime: null,
  isAllDay: false,
  location: "渋谷",
  url: null,
  description: null,
  multipleDetected: false,
};

describe("parseGeminiResponse", () => {
  it("parses a valid JSON string and passes the schema", () => {
    const result = parseGeminiResponse(JSON.stringify(validRaw));
    expect(result).not.toBeNull();
    expect(result?.title).toBe("歯医者");
    expect(result?.startDate).toBe("2026-05-03");
  });

  it("returns null for invalid JSON", () => {
    expect(parseGeminiResponse("{not json")).toBeNull();
  });

  it("returns null when the schema is violated (missing required field)", () => {
    const broken = { ...validRaw } as Partial<typeof validRaw>;
    delete broken.multipleDetected;
    expect(parseGeminiResponse(JSON.stringify(broken))).toBeNull();
  });

  it("returns null when Gemini returns slash-format date (regex violation)", () => {
    const bad = { ...validRaw, startDate: "2026/5/3" };
    expect(parseGeminiResponse(JSON.stringify(bad))).toBeNull();
  });

  it("returns null when Gemini returns Japanese-style time (regex violation)", () => {
    const bad = { ...validRaw, startTime: "午後3時" };
    expect(parseGeminiResponse(JSON.stringify(bad))).toBeNull();
  });

  it("returns null when Gemini returns time without leading zero", () => {
    const bad = { ...validRaw, startTime: "9:00" };
    expect(parseGeminiResponse(JSON.stringify(bad))).toBeNull();
  });

  it("passes through null startDate / startTime (Gemini could not interpret)", () => {
    const allNull = {
      ...validRaw,
      startDate: null,
      startTime: null,
      endDate: null,
      endTime: null,
      isAllDay: true,
    };
    const result = parseGeminiResponse(JSON.stringify(allNull));
    expect(result).not.toBeNull();
    expect(result?.startDate).toBeNull();
    expect(result?.startTime).toBeNull();
  });

  it("passes through multipleDetected: true unchanged", () => {
    const multi = { ...validRaw, multipleDetected: true };
    const result = parseGeminiResponse(JSON.stringify(multi));
    expect(result?.multipleDetected).toBe(true);
  });

  it("strips markdown code fences before parsing", () => {
    const wrapped = "```json\n" + JSON.stringify(validRaw) + "\n```";
    const result = parseGeminiResponse(wrapped);
    expect(result).not.toBeNull();
    expect(result?.title).toBe("歯医者");
  });
});

describe("extractFromImage", () => {
  beforeEach(() => {
    generateContentMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns parsed GeminiRawOutput when SDK responds with valid JSON", async () => {
    generateContentMock.mockResolvedValueOnce({
      text: JSON.stringify(validRaw),
    });
    const result = await extractFromImage("BASE64DATA", "image/png", NOW);
    expect(result).not.toBeNull();
    expect(result?.title).toBe("歯医者");
    expect(generateContentMock).toHaveBeenCalledTimes(1);
  });

  it("passes inlineData with base64 + mimeType to the SDK", async () => {
    generateContentMock.mockResolvedValueOnce({
      text: JSON.stringify(validRaw),
    });
    await extractFromImage("BASE64DATA", "image/jpeg", NOW);
    const call = generateContentMock.mock.calls[0][0];
    expect(call.model).toBe("gemini-2.5-flash");
    const contents = Array.isArray(call.contents) ? call.contents : [call.contents];
    const flat = contents.flatMap((c: unknown) => {
      if (c && typeof c === "object" && "parts" in c) {
        return (c as { parts: unknown[] }).parts;
      }
      return [c];
    });
    const inlinePart = flat.find(
      (p: unknown) => !!p && typeof p === "object" && "inlineData" in p,
    ) as { inlineData: { data: string; mimeType: string } } | undefined;
    expect(inlinePart).toBeTruthy();
    expect(inlinePart?.inlineData.data).toBe("BASE64DATA");
    expect(inlinePart?.inlineData.mimeType).toBe("image/jpeg");
  });

  it("returns null when SDK returns malformed JSON", async () => {
    generateContentMock.mockResolvedValueOnce({ text: "not json at all" });
    const result = await extractFromImage("BASE64DATA", "image/png", NOW);
    expect(result).toBeNull();
  });

  it("returns null when SDK returns schema-violating output", async () => {
    generateContentMock.mockResolvedValueOnce({
      text: JSON.stringify({ ...validRaw, startDate: "2026/5/3" }),
    });
    const result = await extractFromImage("BASE64DATA", "image/png", NOW);
    expect(result).toBeNull();
  });

  it("throws a meaningful error when the SDK throws", async () => {
    generateContentMock.mockRejectedValueOnce(new Error("network down"));
    await expect(
      extractFromImage("BASE64DATA", "image/png", NOW),
    ).rejects.toThrow(/Gemini/);
  });
});

describe("extractFromText", () => {
  beforeEach(() => {
    generateContentMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns parsed GeminiRawOutput when SDK responds with valid JSON", async () => {
    generateContentMock.mockResolvedValueOnce({
      text: JSON.stringify(validRaw),
    });
    const result = await extractFromText("明日 14:00 歯医者 渋谷", NOW);
    expect(result).not.toBeNull();
    expect(result?.title).toBe("歯医者");
  });

  it("embeds the user text in the prompt sent to the SDK", async () => {
    generateContentMock.mockResolvedValueOnce({
      text: JSON.stringify(validRaw),
    });
    await extractFromText("明日 14:00 歯医者", NOW);
    const call = generateContentMock.mock.calls[0][0];
    const flatContents = JSON.stringify(call.contents);
    expect(flatContents).toContain("明日 14:00 歯医者");
  });

  it("includes the JST 'now' reference in the prompt", async () => {
    generateContentMock.mockResolvedValueOnce({
      text: JSON.stringify(validRaw),
    });
    await extractFromText("明日 14:00 歯医者", NOW);
    const call = generateContentMock.mock.calls[0][0];
    const flatContents = JSON.stringify(call.contents);
    // ISO + JST formatted reference — the JST formatted slice "2026-05-02 10:00" should appear.
    expect(flatContents).toContain("2026-05-02");
  });

  it("returns null when SDK returns malformed JSON", async () => {
    generateContentMock.mockResolvedValueOnce({ text: "garbage" });
    const result = await extractFromText("text", NOW);
    expect(result).toBeNull();
  });

  it("throws a meaningful error when the SDK throws", async () => {
    generateContentMock.mockRejectedValueOnce(new Error("auth failed"));
    await expect(extractFromText("text", NOW)).rejects.toThrow(/Gemini/);
  });

  it("returns null when SDK returns empty text", async () => {
    generateContentMock.mockResolvedValueOnce({ text: "" });
    const result = await extractFromText("text", NOW);
    expect(result).toBeNull();
  });
});
