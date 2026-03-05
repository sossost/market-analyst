import { describe, it, expect } from "vitest";
import { resolveVolumeConfirmed } from "@/etl/utils/common";

describe("resolveVolumeConfirmed", () => {
  describe("Phase != 2 → null", () => {
    it("returns null for Phase 1", () => {
      expect(resolveVolumeConfirmed(1, null, 3.0, null)).toBe(null);
    });

    it("returns null for Phase 3", () => {
      expect(resolveVolumeConfirmed(3, 2, 1.5, true)).toBe(null);
    });

    it("returns null for Phase 4", () => {
      expect(resolveVolumeConfirmed(4, 3, 0.5, null)).toBe(null);
    });
  });

  describe("New Phase 2 entry (prevPhase != 2)", () => {
    it("returns true when vol_ratio >= 2.0", () => {
      expect(resolveVolumeConfirmed(2, 1, 2.5, null)).toBe(true);
    });

    it("returns true when vol_ratio == 2.0 (boundary)", () => {
      expect(resolveVolumeConfirmed(2, 1, 2.0, null)).toBe(true);
    });

    it("returns false when vol_ratio < 2.0", () => {
      expect(resolveVolumeConfirmed(2, 1, 1.8, null)).toBe(false);
    });

    it("returns false when vol_ratio is null", () => {
      expect(resolveVolumeConfirmed(2, 1, null, null)).toBe(false);
    });

    it("returns true when prevPhase is null (first appearance) and vol >= 2x", () => {
      expect(resolveVolumeConfirmed(2, null, 3.0, null)).toBe(true);
    });

    it("returns false when prevPhase is null and vol < 2x", () => {
      expect(resolveVolumeConfirmed(2, null, 1.0, null)).toBe(false);
    });
  });

  describe("Phase 2 continuation (prevPhase == 2)", () => {
    it("keeps true once confirmed", () => {
      expect(resolveVolumeConfirmed(2, 2, 0.8, true)).toBe(true);
    });

    it("upgrades to true when vol_ratio >= 2.0 and previously unconfirmed", () => {
      expect(resolveVolumeConfirmed(2, 2, 2.5, false)).toBe(true);
    });

    it("upgrades to true when vol_ratio == 2.0 boundary and previously unconfirmed", () => {
      expect(resolveVolumeConfirmed(2, 2, 2.0, false)).toBe(true);
    });

    it("stays false when vol_ratio < 2.0 and previously unconfirmed", () => {
      expect(resolveVolumeConfirmed(2, 2, 1.5, false)).toBe(false);
    });

    it("stays false when vol_ratio is null and previously unconfirmed", () => {
      expect(resolveVolumeConfirmed(2, 2, null, false)).toBe(false);
    });

    it("defaults to false when prevVolumeConfirmed is null and vol < 2x", () => {
      expect(resolveVolumeConfirmed(2, 2, 1.5, null)).toBe(false);
    });

    it("upgrades from null to true when vol >= 2x", () => {
      expect(resolveVolumeConfirmed(2, 2, 3.0, null)).toBe(true);
    });
  });
});
