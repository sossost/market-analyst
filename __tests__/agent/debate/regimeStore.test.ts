import { describe, it, expect, vi } from "vitest";

// Mock logger before importing module
vi.mock("../../../src/agent/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    step: vi.fn(),
  },
}));

// Mock DB (not needed for pure function tests, but prevents import errors)
vi.mock("../../../src/db/client.js", () => ({
  db: {},
}));

import {
  validateRegimeInput,
  formatRegimeForPrompt,
  areDatesConsecutive,
  type MarketRegimeRow,
} from "@/debate/regimeStore.js";
import type { MarketRegimeType } from "../../../src/db/schema/analyst.js";

// ─── 픽스처 헬퍼 ─────────────────────────────────────────────────────────────

function makeRow(overrides: Partial<MarketRegimeRow> = {}): MarketRegimeRow {
  return {
    regimeDate: "2026-03-09",
    regime: "MID_BULL",
    rationale: "test",
    confidence: "medium",
    isConfirmed: true,
    confirmedAt: "2026-03-09",
    ...overrides,
  };
}

// ─── areDatesConsecutive ──────────────────────────────────────────────────────

describe("areDatesConsecutive", () => {
  it("단일 날짜는 항상 연속으로 판정한다", () => {
    expect(areDatesConsecutive(["2026-03-10"])).toBe(true);
  });

  it("빈 배열은 연속으로 판정한다", () => {
    expect(areDatesConsecutive([])).toBe(true);
  });

  it("평일 연속(월→화, 1일 차이)을 연속으로 판정한다", () => {
    // DESC 정렬: 화요일, 월요일
    expect(areDatesConsecutive(["2026-03-10", "2026-03-09"])).toBe(true);
  });

  it("금요일→월요일(3일 차이)을 연속 거래일로 판정한다", () => {
    // 2026-03-16(월) ~ 2026-03-13(금) = 3일 차이
    expect(areDatesConsecutive(["2026-03-16", "2026-03-13"])).toBe(true);
  });

  it("공휴일+주말 조합 4일 차이를 연속 거래일로 판정한다", () => {
    // 예: 목요일(목)이 공휴일이어서 수요일→월요일 = 5일 → 초과
    // 공휴일 하루(금요일)로 인해 목요일→월요일 = 4일 → 허용
    expect(areDatesConsecutive(["2026-01-05", "2026-01-01"])).toBe(true); // 4일 차이
  });

  it("5일 이상 차이는 연속이 아닌 것으로 판정한다", () => {
    // 수요일→월요일: 수(공휴)+목(공휴)+금+토일 → 5일 차이
    expect(areDatesConsecutive(["2026-03-16", "2026-03-11"])).toBe(false); // 5일 차이
  });

  it("중간에 5일 초과 간격이 있으면 연속이 아닌 것으로 판정한다", () => {
    // 3개 날짜 중 한 쌍이 초과
    expect(
      areDatesConsecutive(["2026-03-17", "2026-03-16", "2026-03-10"]),
    ).toBe(false);
  });
});

// ─── validateRegimeInput ──────────────────────────────────────────────────────

describe("validateRegimeInput", () => {
  it("returns valid input for correct data", () => {
    const result = validateRegimeInput({
      regime: "EARLY_BULL",
      rationale: "시장 바닥 돌파 시그널",
      confidence: "high",
    });

    expect(result).toEqual({
      regime: "EARLY_BULL",
      rationale: "시장 바닥 돌파 시그널",
      confidence: "high",
    });
  });

  it("returns null for null input", () => {
    expect(validateRegimeInput(null)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(validateRegimeInput(undefined)).toBeNull();
  });

  it("returns null for non-object input", () => {
    expect(validateRegimeInput("string")).toBeNull();
    expect(validateRegimeInput(42)).toBeNull();
  });

  it("returns null for invalid regime value", () => {
    const result = validateRegimeInput({
      regime: "SUPER_BULL",
      rationale: "some reason",
      confidence: "high",
    });

    expect(result).toBeNull();
  });

  it("returns null when regime is missing", () => {
    const result = validateRegimeInput({
      rationale: "some reason",
      confidence: "high",
    });

    expect(result).toBeNull();
  });

  it("returns null for empty rationale", () => {
    const result = validateRegimeInput({
      regime: "MID_BULL",
      rationale: "",
      confidence: "medium",
    });

    expect(result).toBeNull();
  });

  it("returns null when rationale is missing", () => {
    const result = validateRegimeInput({
      regime: "MID_BULL",
      confidence: "medium",
    });

    expect(result).toBeNull();
  });

  it("falls back to 'low' when confidence is missing", () => {
    const result = validateRegimeInput({
      regime: "BEAR",
      rationale: "약세장 진입",
    });

    expect(result).toEqual({
      regime: "BEAR",
      rationale: "약세장 진입",
      confidence: "low",
    });
  });

  it("falls back to 'low' when confidence is invalid", () => {
    const result = validateRegimeInput({
      regime: "LATE_BULL",
      rationale: "과열 경계",
      confidence: "very_high",
    });

    expect(result).toEqual({
      regime: "LATE_BULL",
      rationale: "과열 경계",
      confidence: "low",
    });
  });

  it("accepts all valid regime types", () => {
    const regimes = [
      "EARLY_BULL",
      "MID_BULL",
      "LATE_BULL",
      "EARLY_BEAR",
      "BEAR",
    ];

    for (const regime of regimes) {
      const result = validateRegimeInput({
        regime,
        rationale: "test",
        confidence: "medium",
      });
      expect(result).not.toBeNull();
      expect(result?.regime).toBe(regime);
    }
  });

  it("accepts all valid confidence levels", () => {
    const confidences = ["low", "medium", "high"];

    for (const confidence of confidences) {
      const result = validateRegimeInput({
        regime: "MID_BULL",
        rationale: "test",
        confidence,
      });
      expect(result?.confidence).toBe(confidence);
    }
  });
});

// ─── formatRegimeForPrompt ────────────────────────────────────────────────────

describe("formatRegimeForPrompt", () => {
  it("returns empty string for empty array", () => {
    expect(formatRegimeForPrompt([])).toBe("");
  });

  it("formats single regime — 현재 확정 레짐 표시", () => {
    const rows: MarketRegimeRow[] = [
      makeRow({
        regimeDate: "2026-03-09",
        regime: "EARLY_BULL",
        rationale: "바닥 돌파 시그널 감지",
        confidence: "high",
        isConfirmed: true,
        confirmedAt: "2026-03-09",
      }),
    ];

    const result = formatRegimeForPrompt(rows);

    expect(result).toContain("## 시장 레짐 현황");
    expect(result).toContain("EARLY_BULL");
    expect(result).toContain("초기 강세");
    expect(result).toContain("high confidence");
    expect(result).toContain("바닥 돌파 시그널 감지");
    expect(result).not.toContain("### 최근 확정 레짐 히스토리");
  });

  it("includes history section for multiple regimes", () => {
    const rows: MarketRegimeRow[] = [
      makeRow({ regimeDate: "2026-03-09", regime: "MID_BULL", isConfirmed: true }),
      makeRow({ regimeDate: "2026-03-08", regime: "EARLY_BULL", confidence: "high", isConfirmed: true }),
    ];

    const result = formatRegimeForPrompt(rows);

    expect(result).toContain("### 최근 확정 레짐 히스토리");
    expect(result).toContain("2026-03-09: MID_BULL (medium)");
    expect(result).toContain("2026-03-08: EARLY_BULL (high)");
  });

  it("includes EARLY_BULL action guide", () => {
    const rows: MarketRegimeRow[] = [
      makeRow({ regime: "EARLY_BULL", isConfirmed: true }),
    ];

    const result = formatRegimeForPrompt(rows);
    expect(result).toContain("바닥 돌파 신호 적극 포착");
    expect(result).toContain("Phase 1→2 전환 종목에 주목");
  });

  it("includes MID_BULL action guide", () => {
    const rows: MarketRegimeRow[] = [
      makeRow({ regime: "MID_BULL", isConfirmed: true }),
    ];

    const result = formatRegimeForPrompt(rows);
    expect(result).toContain("주도섹터/주도주 포착에 집중");
  });

  it("includes LATE_BULL action guide", () => {
    const rows: MarketRegimeRow[] = [
      makeRow({ regime: "LATE_BULL", confidence: "low", isConfirmed: true }),
    ];

    const result = formatRegimeForPrompt(rows);
    expect(result).toContain("과열 경계");
    expect(result).toContain("보수적 접근");
  });

  it("includes EARLY_BEAR action guide", () => {
    const rows: MarketRegimeRow[] = [
      makeRow({ regime: "EARLY_BEAR", isConfirmed: true }),
    ];

    const result = formatRegimeForPrompt(rows);
    expect(result).toContain("방어 전환 필요");
    expect(result).toContain("Phase 2 추천 최소화");
  });

  it("includes BEAR action guide", () => {
    const rows: MarketRegimeRow[] = [
      makeRow({ regime: "BEAR", confidence: "high", isConfirmed: true }),
    ];

    const result = formatRegimeForPrompt(rows);
    expect(result).toContain("약세장");
    expect(result).toContain("현금 비중 확대 고려");
  });

  it("uses correct label for each regime type", () => {
    const labelMap: Record<MarketRegimeType, string> = {
      EARLY_BULL: "초기 강세",
      MID_BULL: "중기 강세",
      LATE_BULL: "후기 강세 (과열 경계)",
      EARLY_BEAR: "초기 약세 (방어 전환)",
      BEAR: "약세장 (위양성 주의)",
    };

    for (const [regime, label] of Object.entries(labelMap)) {
      const rows: MarketRegimeRow[] = [
        makeRow({ regime: regime as MarketRegimeType, isConfirmed: true }),
      ];

      const result = formatRegimeForPrompt(rows);
      expect(result).toContain(label);
    }
  });

  it("limits history to 14 entries", () => {
    const rows: MarketRegimeRow[] = Array.from({ length: 20 }, (_, i) => ({
      regimeDate: `2026-03-${String(20 - i).padStart(2, "0")}`,
      regime: "MID_BULL" as MarketRegimeType,
      rationale: "test",
      confidence: "medium" as const,
      isConfirmed: true,
      confirmedAt: `2026-03-${String(20 - i).padStart(2, "0")}`,
    }));

    const result = formatRegimeForPrompt(rows);

    // Should contain the first 14 history entries (slice 0..14)
    expect(result).toContain("2026-03-20");
    expect(result).toContain("2026-03-07"); // 14th entry (index 13)
    expect(result).not.toContain("2026-03-06"); // 15th entry should be excluded
  });

  it("pending rows가 있으면 pending 섹션을 표시한다", () => {
    const confirmed = [makeRow({ regime: "MID_BULL", isConfirmed: true })];
    const pending = [
      makeRow({
        regimeDate: "2026-03-15",
        regime: "EARLY_BEAR",
        isConfirmed: false,
        confirmedAt: null,
      }),
    ];

    const result = formatRegimeForPrompt(confirmed, pending);

    expect(result).toContain("pending 판정");
    expect(result).toContain("EARLY_BEAR");
  });
});
