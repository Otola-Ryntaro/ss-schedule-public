// where: __tests__/origin-guard.test.ts
// what:  Unit tests for assertSameOrigin — CSRF defense for POST API routes.
// why:   Origin host vs AUTH_URL host vs self host comparison must be performed by URL.host
//        (not string equality) so port / scheme differences don't slip through.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { assertSameOrigin } from "@/lib/origin-guard";

const ORIGINAL_AUTH_URL = process.env.AUTH_URL;

function makeRequest(headers: Record<string, string>): NextRequest {
  return new NextRequest("https://app.example.com/api/extract", {
    method: "POST",
    headers,
  });
}

describe("assertSameOrigin", () => {
  beforeEach(() => {
    process.env.AUTH_URL = "https://app.example.com";
  });

  afterEach(() => {
    if (ORIGINAL_AUTH_URL === undefined) {
      delete process.env.AUTH_URL;
    } else {
      process.env.AUTH_URL = ORIGINAL_AUTH_URL;
    }
  });

  it("passes when Origin host matches AUTH_URL host", () => {
    const req = makeRequest({
      origin: "https://app.example.com",
      "sec-fetch-site": "same-origin",
    });
    expect(() => assertSameOrigin(req)).not.toThrow();
  });

  it("passes when Origin host matches self host (x-forwarded-host)", () => {
    process.env.AUTH_URL = "https://configured.example.com";
    const req = makeRequest({
      origin: "https://app.example.com",
      "x-forwarded-host": "app.example.com",
      "sec-fetch-site": "same-origin",
    });
    expect(() => assertSameOrigin(req)).not.toThrow();
  });

  it("passes when Sec-Fetch-Site is same-site even if Origin missing", () => {
    const req = makeRequest({
      "sec-fetch-site": "same-origin",
    });
    expect(() => assertSameOrigin(req)).not.toThrow();
  });

  it("rejects when Origin host does not match", () => {
    const req = makeRequest({
      origin: "https://evil.example.com",
      "sec-fetch-site": "same-origin",
    });
    expect(() => assertSameOrigin(req)).toThrow(/origin/i);
  });

  it("rejects when Sec-Fetch-Site is cross-site", () => {
    const req = makeRequest({
      origin: "https://app.example.com",
      "sec-fetch-site": "cross-site",
    });
    expect(() => assertSameOrigin(req)).toThrow();
  });

  it("rejects when both Origin and Sec-Fetch-Site are missing", () => {
    const req = makeRequest({});
    expect(() => assertSameOrigin(req)).toThrow();
  });

  it("rejects when Origin is malformed (URL parse failure)", () => {
    const req = makeRequest({
      origin: "not a url",
      "sec-fetch-site": "same-origin",
    });
    expect(() => assertSameOrigin(req)).toThrow();
  });

  it("treats different ports as different hosts", () => {
    const req = makeRequest({
      origin: "https://app.example.com:8080",
      "sec-fetch-site": "same-origin",
    });
    // host includes port → "app.example.com:8080" vs "app.example.com" → mismatch.
    expect(() => assertSameOrigin(req)).toThrow();
  });
});
