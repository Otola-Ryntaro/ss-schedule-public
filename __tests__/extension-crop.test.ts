import { describe, expect, it } from "vitest";
import { getCropRect } from "@/extension/src/lib/crop";

describe("extension crop helpers", () => {
  it("scales viewport CSS pixels by devicePixelRatio", () => {
    expect(
      getCropRect(
        {
          dataUrl: "data:image/png;base64,",
          dpr: 2,
          rect: { x: 10, y: 20, width: 100, height: 80 },
        },
        400,
        300,
      ),
    ).toEqual({ sx: 20, sy: 40, sw: 200, sh: 160 });
  });

  it("clamps crop dimensions to the captured image", () => {
    expect(
      getCropRect(
        {
          dataUrl: "data:image/png;base64,",
          dpr: 2,
          rect: { x: 180, y: 120, width: 100, height: 100 },
        },
        400,
        260,
      ),
    ).toEqual({ sx: 360, sy: 240, sw: 40, sh: 20 });
  });
});
