import { describe, it, expect } from "vitest";
import { getEvidenceStrength } from "../memoryLoader.js";

describe("getEvidenceStrength", () => {
  it("hitCount 0 — 약한 근거", () => {
    expect(getEvidenceStrength(0)).toBe("⚠️ 약한 근거");
  });

  it("hitCount 1 — 약한 근거", () => {
    expect(getEvidenceStrength(1)).toBe("⚠️ 약한 근거");
  });

  it("hitCount 2 — 약한 근거", () => {
    expect(getEvidenceStrength(2)).toBe("⚠️ 약한 근거");
  });

  it("hitCount 3 — 중간 근거", () => {
    expect(getEvidenceStrength(3)).toBe("중간 근거");
  });

  it("hitCount 4 — 중간 근거", () => {
    expect(getEvidenceStrength(4)).toBe("중간 근거");
  });

  it("hitCount 5 — 강한 근거", () => {
    expect(getEvidenceStrength(5)).toBe("강한 근거");
  });

  it("hitCount 100 — 강한 근거", () => {
    expect(getEvidenceStrength(100)).toBe("강한 근거");
  });
});
