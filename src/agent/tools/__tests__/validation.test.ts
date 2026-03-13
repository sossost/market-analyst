import { describe, it, expect, vi, beforeEach } from "vitest";
import { clampPercent } from "../validation";

describe("clampPercent", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns value as-is when within 0~100 range", () => {
    expect(clampPercent(35.2, "test")).toBe(35.2);
    expect(clampPercent(0, "test")).toBe(0);
    expect(clampPercent(100, "test")).toBe(100);
    expect(clampPercent(50.5, "test")).toBe(50.5);
  });

  it("returns null when value exceeds 100 — forces QA mismatch", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = clampPercent(3520.0, "phase2Ratio");

    expect(result).toBeNull();
    expect(errorSpy).toHaveBeenCalledOnce();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("3520"),
    );
  });

  it("clamps to 0 when value is negative", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = clampPercent(-5, "negativeTest");

    expect(result).toBe(0);
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("-5"),
    );
  });

  it("includes label in error message for debugging", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    clampPercent(200, "sector:Technology:phase2Ratio");

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("sector:Technology:phase2Ratio"),
    );
  });

  it("does not warn or error for boundary value 100", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = clampPercent(100, "boundary");

    expect(result).toBe(100);
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("does not warn or error for boundary value 0", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = clampPercent(0, "boundary");

    expect(result).toBe(0);
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
