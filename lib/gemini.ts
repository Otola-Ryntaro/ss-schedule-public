// where: lib/gemini.ts
// what:  Gemini API wrapper. Extracts a single event (raw form, see GeminiRawOutputSchema)
//        from either an image (base64 + mimeType) or a text input. Pure parser is exported
//        separately for unit testing without an SDK call.
// why:   Isolating @google/genai here keeps the rest of the app free of SDK details.
//        Date-time normalization (ISO assembly, boundary correction) lives in lib/datetime.ts.
//        Server-only: GEMINI_API_KEY is auto-read by the SDK from process.env. Never reference
//        it explicitly or expose it to the client.

import { GoogleGenAI, type GenerateContentResponse } from "@google/genai";
import { z } from "zod";
import { GeminiRawOutputSchema, type GeminiRawOutput } from "./schema";
import { buildImagePrompt, buildTextPrompt } from "./prompts";

const MODEL = "gemini-2.5-flash";

// Generated once: zod v4's native z.toJSONSchema produces a JSON Schema the Gemini SDK
// accepts via responseJsonSchema. (zod-to-json-schema v3 is a zod-v3-only package and
// is type-incompatible with zod v4, so we use the built-in instead.)
const responseJsonSchema = z.toJSONSchema(GeminiRawOutputSchema);

// Lazy singleton — constructed on first use so unit tests that don't hit the network
// don't require GEMINI_API_KEY in their environment.
let clientSingleton: GoogleGenAI | null = null;
function getClient(): GoogleGenAI {
  if (!clientSingleton) {
    // Do NOT pass apiKey explicitly: SDK reads process.env.GEMINI_API_KEY automatically.
    clientSingleton = new GoogleGenAI({});
  }
  return clientSingleton;
}

// Strip optional ```json ... ``` markdown fences that some models emit despite
// responseMimeType: "application/json". Defensive only.
function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("```")) {
    return trimmed
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();
  }
  return trimmed;
}

// Pure parser: JSON.parse → GeminiRawOutputSchema.parse. Returns null on any failure.
// Exported for direct unit testing without mocking the SDK.
export function parseGeminiResponse(raw: string): GeminiRawOutput | null {
  if (!raw || typeof raw !== "string") return null;
  const cleaned = stripCodeFence(raw);
  if (!cleaned) return null;

  let json: unknown;
  try {
    json = JSON.parse(cleaned);
  } catch {
    return null;
  }

  const parsed = GeminiRawOutputSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

// Shared SDK call config. Double-validation pattern: the SDK enforces structured output
// via responseJsonSchema, then we re-validate with zod (recommended by the official docs).
function buildConfig() {
  return {
    responseMimeType: "application/json",
    responseJsonSchema,
  };
}

// Wrap arbitrary SDK errors so the API Route can surface a meaningful message.
// Uses Error `cause` (Node 16.9+ / TS 4.6+) to preserve the original stack for debugging.
function wrapSdkError(err: unknown): Error {
  if (err instanceof Error) {
    return new Error(`Gemini API call failed: ${err.message}`, { cause: err });
  }
  return new Error("Gemini API call failed: unknown error");
}

export async function extractFromImage(
  imageBase64: string,
  mimeType: string,
  now: Date,
): Promise<GeminiRawOutput | null> {
  const client = getClient();
  const prompt = buildImagePrompt(now);

  let response: GenerateContentResponse;
  try {
    response = await client.models.generateContent({
      model: MODEL,
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { data: imageBase64, mimeType } },
            { text: prompt },
          ],
        },
      ],
      config: buildConfig(),
    });
  } catch (err) {
    throw wrapSdkError(err);
  }

  const text = response?.text ?? "";
  return parseGeminiResponse(text);
}

export async function extractFromText(
  text: string,
  now: Date,
): Promise<GeminiRawOutput | null> {
  const client = getClient();
  const prompt = buildTextPrompt(text, now);

  let response: GenerateContentResponse;
  try {
    response = await client.models.generateContent({
      model: MODEL,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: buildConfig(),
    });
  } catch (err) {
    throw wrapSdkError(err);
  }

  const raw = response?.text ?? "";
  return parseGeminiResponse(raw);
}
