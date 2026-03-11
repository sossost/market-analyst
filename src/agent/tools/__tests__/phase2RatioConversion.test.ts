import { describe, it, expect, vi } from "vitest";
import { toNum } from "@/etl/utils/common";
import { clampPercent } from "../validation";

/**
 * Phase 2 ratio 이중 변환 방어 테스트.
 *
 * DB: phase2_ratio는 0~1 (e.g. 0.352 = 35.2%)
 * 변환: toNum(phase2_ratio) * 100 → 35.2
 * Guard: clampPercent로 100 초과 시 클램핑
 */
describe("Phase 2 ratio conversion", () => {
  it("converts DB ratio 0.352 to 35.2%", () => {
    const dbValue = "0.352";
    const percent = Number((toNum(dbValue) * 100).toFixed(1));
    expect(percent).toBe(35.2);
  });

  it("converts DB ratio 0 to 0%", () => {
    const dbValue = "0";
    const percent = Number((toNum(dbValue) * 100).toFixed(1));
    expect(percent).toBe(0);
  });

  it("converts DB ratio 1.0 to 100%", () => {
    const dbValue = "1.0";
    const percent = Number((toNum(dbValue) * 100).toFixed(1));
    expect(percent).toBe(100);
  });

  it("handles null DB value as 0%", () => {
    const dbValue = null;
    const percent = Number((toNum(dbValue) * 100).toFixed(1));
    expect(percent).toBe(0);
  });

  describe("double conversion detection", () => {
    it("detects when already-percent value (35.2) is multiplied by 100 again", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      // Scenario: DB stores 0.352, first conversion gives 35.2,
      // if erroneously stored as 35.2 and converted again: 35.2 * 100 = 3520
      const alreadyPercent = 35.2;
      const doubleConverted = Number((alreadyPercent * 100).toFixed(1));

      expect(doubleConverted).toBe(3520);

      // Guard catches this
      const result = clampPercent(doubleConverted, "test:phase2Ratio");
      expect(result).toBe(100);
      expect(warnSpy).toHaveBeenCalledOnce();

      warnSpy.mockRestore();
    });

    it("passes through correctly converted value without warning", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const dbValue = "0.352";
      const percent = Number((toNum(dbValue) * 100).toFixed(1));
      const result = clampPercent(percent, "test:phase2Ratio");

      expect(result).toBe(35.2);
      expect(warnSpy).not.toHaveBeenCalled();

      warnSpy.mockRestore();
    });

    it("detects 3050% pattern (DB value 0.305 double-converted)", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      // DB stores 0.305, first conversion gives 30.5,
      // if erroneously treated as ratio again: 30.5 * 100 = 3050
      const alreadyPercent = 30.5;
      const doubleConverted = Number((alreadyPercent * 100).toFixed(1));

      expect(doubleConverted).toBe(3050);

      const result = clampPercent(doubleConverted, "test:phase2Ratio");
      expect(result).toBe(100);
      expect(warnSpy).toHaveBeenCalledOnce();

      warnSpy.mockRestore();
    });

    it("detects 10000% pattern (DB value 1.0 double-converted)", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const alreadyPercent = 100;
      const doubleConverted = alreadyPercent * 100;

      expect(doubleConverted).toBe(10000);

      const result = clampPercent(doubleConverted, "test:phase2Ratio");
      expect(result).toBe(100);
      expect(warnSpy).toHaveBeenCalledOnce();

      warnSpy.mockRestore();
    });
  });
});
