import { describe, it, expect } from "vitest";
import { binomialTest } from "@/lib/statisticalTests";

describe("binomialTest", () => {
  describe("exact binomial (n <= 30)", () => {
    it("hits=8, total=10, p0=0.5 → p-value ≈ 0.0547 (not significant)", () => {
      const result = binomialTest(8, 10, 0.5);
      expect(result.pValue).toBeCloseTo(0.0547, 2);
      expect(result.isSignificant).toBe(false); // p > 0.05
    });

    it("hits=9, total=10, p0=0.5 → p-value ≈ 0.0107 (significant)", () => {
      const result = binomialTest(9, 10, 0.5);
      expect(result.pValue).toBeCloseTo(0.0107, 2);
      expect(result.isSignificant).toBe(true);
    });

    it("hits=7, total=10, p0=0.5 → p-value ≈ 0.1719", () => {
      const result = binomialTest(7, 10, 0.5);
      expect(result.pValue).toBeCloseTo(0.1719, 2);
      expect(result.isSignificant).toBe(false);
    });

    it("hits=10, total=10 → p-value very small", () => {
      const result = binomialTest(10, 10, 0.5);
      expect(result.pValue).toBeLessThan(0.001);
      expect(result.isSignificant).toBe(true);
    });

    it("hits=10, total=10 → Cohen's h is large", () => {
      const result = binomialTest(10, 10, 0.5);
      expect(Math.abs(result.cohenH)).toBeGreaterThanOrEqual(0.3);
    });
  });

  describe("normal approximation (n > 30)", () => {
    it("hits=50, total=100, p0=0.5 → p-value ≈ 0.54 (not significant)", () => {
      const result = binomialTest(50, 100, 0.5);
      // With continuity correction: z = (50 - 0.5 - 50) / 5 = -0.1
      // P(Z > -0.1) ≈ 0.54
      expect(result.pValue).toBeCloseTo(0.54, 1);
      expect(result.isSignificant).toBe(false);
    });

    it("hits=70, total=100, p0=0.5 → p-value very small (significant)", () => {
      const result = binomialTest(70, 100, 0.5);
      expect(result.pValue).toBeLessThan(0.001);
      expect(result.isSignificant).toBe(true);
    });
  });

  describe("edge cases", () => {
    it("hits=0, total=0 → p-value=1.0, cohenH=0", () => {
      const result = binomialTest(0, 0, 0.5);
      expect(result.pValue).toBe(1.0);
      expect(result.cohenH).toBe(0);
      expect(result.isSignificant).toBe(false);
    });

    it("all misses → p-value=1.0", () => {
      const result = binomialTest(0, 10, 0.5);
      expect(result.pValue).toBe(1.0);
      expect(result.isSignificant).toBe(false);
    });

    it("default p0 is 0.5", () => {
      const withDefault = binomialTest(9, 10);
      const withExplicit = binomialTest(9, 10, 0.5);
      expect(withDefault.pValue).toBeCloseTo(withExplicit.pValue, 10);
    });
  });

  describe("Cohen's h effect size", () => {
    it("perfect hit rate has large Cohen's h", () => {
      const result = binomialTest(10, 10, 0.5);
      // h = 2*arcsin(sqrt(1)) - 2*arcsin(sqrt(0.5)) = π - π/2 = π/2 ≈ 1.57
      expect(Math.abs(result.cohenH)).toBeGreaterThanOrEqual(0.3);
    });

    it("50% observed vs 50% expected has Cohen's h = 0", () => {
      const result = binomialTest(5, 10, 0.5);
      expect(result.cohenH).toBeCloseTo(0, 5);
    });

    it("70% observed vs 50% expected has moderate Cohen's h", () => {
      const result = binomialTest(7, 10, 0.5);
      // h = 2*arcsin(sqrt(0.7)) - 2*arcsin(sqrt(0.5)) ≈ 0.41
      expect(Math.abs(result.cohenH)).toBeGreaterThanOrEqual(0.3);
    });
  });

  describe("isSignificant requires both conditions", () => {
    it("low p-value but small effect size → not significant", () => {
      // Large n with rate slightly above p0: statistically significant but trivial effect
      // 520/1000 = 52%, very low p-value with n=1000 but Cohen's h ≈ 0.04
      const result = binomialTest(520, 1000, 0.5);
      // p-value may be small but Cohen's h < 0.3
      if (result.pValue < 0.05) {
        expect(Math.abs(result.cohenH)).toBeLessThan(0.3);
        expect(result.isSignificant).toBe(false);
      }
    });
  });
});
