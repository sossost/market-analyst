import { describe, it, expect } from "vitest";
import { shouldUpgradeTier } from "../backfill-sepa-grade.js";

describe("shouldUpgradeTier", () => {
  it("S등급 + standard tier이면 승격한다", () => {
    expect(shouldUpgradeTier("S", "standard")).toBe(true);
  });

  it("A등급 + standard tier이면 승격한다", () => {
    expect(shouldUpgradeTier("A", "standard")).toBe(true);
  });

  it("B등급 + standard tier이면 승격하지 않는다", () => {
    expect(shouldUpgradeTier("B", "standard")).toBe(false);
  });

  it("C등급 + standard tier이면 승격하지 않는다", () => {
    expect(shouldUpgradeTier("C", "standard")).toBe(false);
  });

  it("F등급 + standard tier이면 승격하지 않는다", () => {
    expect(shouldUpgradeTier("F", "standard")).toBe(false);
  });

  it("S등급이지만 이미 featured이면 승격하지 않는다", () => {
    expect(shouldUpgradeTier("S", "featured")).toBe(false);
  });

  it("A등급이지만 이미 featured이면 승격하지 않는다", () => {
    expect(shouldUpgradeTier("A", "featured")).toBe(false);
  });

  it("grade가 null이면 승격하지 않는다", () => {
    expect(shouldUpgradeTier(null, "standard")).toBe(false);
  });
});
