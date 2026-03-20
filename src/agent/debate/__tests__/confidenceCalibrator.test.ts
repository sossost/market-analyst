import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── DB 모킹 ─────────────────────────────────────────────────────────────────

const mockSelect = vi.fn();
const mockFrom = vi.fn();
const mockWhere = vi.fn();
const mockGroupBy = vi.fn();

vi.mock("../../../db/client.js", () => ({
  db: {
    select: (...args: unknown[]) => {
      mockSelect(...args);
      return {
        from: (...a: unknown[]) => {
          mockFrom(...a);
          return {
            where: (...b: unknown[]) => {
              mockWhere(...b);
              return {
                groupBy: mockGroupBy,
              };
            },
          };
        },
      };
    },
  },
}));

vi.mock("drizzle-orm", () => ({
  sql: (str: unknown) => str,
  eq: (col: unknown, val: unknown) => ({ col, val }),
  inArray: (col: unknown, vals: unknown) => ({ col, vals }),
}));

vi.mock("../../../db/schema/analyst.js", () => ({
  theses: {
    confidence: "confidence",
    status: "status",
  },
}));

vi.mock("../../logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// ─── 모킹 후 대상 모듈 import ─────────────────────────────────────────────────

import {
  calcCalibrationBins,
  buildBinsFromRows,
  calcECE,
  getCalibrationResult,
  formatCalibrationForPrompt,
  generateFeedback,
  type CalibrationBin,
  type CalibrationResult,
} from "../confidenceCalibrator.js";

// ─── 헬퍼 ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

function makeBin(overrides: Partial<CalibrationBin> & Pick<CalibrationBin, "confidence">): CalibrationBin {
  const defaults: Record<string, CalibrationBin> = {
    low: { confidence: "low", expectedRate: 0.4, actualRate: null, confirmed: 0, invalidated: 0, total: 0, gap: null },
    medium: { confidence: "medium", expectedRate: 0.6, actualRate: null, confirmed: 0, invalidated: 0, total: 0, gap: null },
    high: { confidence: "high", expectedRate: 0.8, actualRate: null, confirmed: 0, invalidated: 0, total: 0, gap: null },
  };
  return { ...defaults[overrides.confidence], ...overrides };
}

// ─── buildBinsFromRows ──────────────────────────────────────────────────────

describe("buildBinsFromRows", () => {
  it("모든 confidence 레벨을 포함한다 (데이터 없는 레벨도)", () => {
    const bins = buildBinsFromRows([]);
    expect(bins).toHaveLength(3);
    expect(bins.map((b) => b.confidence)).toEqual(["low", "medium", "high"]);
  });

  it("적중률과 gap을 올바르게 계산한다", () => {
    const bins = buildBinsFromRows([
      { confidence: "high", confirmed: 6, invalidated: 4 },
      { confidence: "medium", confirmed: 3, invalidated: 7 },
    ]);

    const high = bins.find((b) => b.confidence === "high")!;
    expect(high.total).toBe(10);
    expect(high.actualRate).toBe(0.6); // 6/10
    expect(high.gap).toBeCloseTo(0.2); // 0.8 - 0.6 = 과신 +0.2

    const medium = bins.find((b) => b.confidence === "medium")!;
    expect(medium.actualRate).toBe(0.3); // 3/10
    expect(medium.gap).toBeCloseTo(0.3); // 0.6 - 0.3 = 과신 +0.3
  });

  it("데이터 없는 레벨은 actualRate=null, gap=null", () => {
    const bins = buildBinsFromRows([
      { confidence: "high", confirmed: 5, invalidated: 5 },
    ]);

    const low = bins.find((b) => b.confidence === "low")!;
    expect(low.actualRate).toBeNull();
    expect(low.gap).toBeNull();
    expect(low.total).toBe(0);
  });
});

// ─── calcECE ────────────────────────────────────────────────────────────────

describe("calcECE", () => {
  it("가중 평균 절대 오차를 산출한다", () => {
    const bins: CalibrationBin[] = [
      makeBin({ confidence: "low", expectedRate: 0.4, actualRate: 0.5, total: 10, gap: -0.1 }),
      makeBin({ confidence: "medium", expectedRate: 0.6, actualRate: 0.4, total: 20, gap: 0.2 }),
      makeBin({ confidence: "high", expectedRate: 0.8, actualRate: 0.6, total: 10, gap: 0.2 }),
    ];

    // ECE = (10/40)*|0.4-0.5| + (20/40)*|0.6-0.4| + (10/40)*|0.8-0.6|
    //      = 0.25*0.1 + 0.5*0.2 + 0.25*0.2
    //      = 0.025 + 0.1 + 0.05 = 0.175
    const ece = calcECE(bins);
    expect(ece).toBe(0.175);
  });

  it("데이터 없으면 null 반환", () => {
    const bins: CalibrationBin[] = [
      makeBin({ confidence: "low" }),
      makeBin({ confidence: "medium" }),
      makeBin({ confidence: "high" }),
    ];
    expect(calcECE(bins)).toBeNull();
  });

  it("일부 빈만 데이터 있어도 계산 가능", () => {
    const bins: CalibrationBin[] = [
      makeBin({ confidence: "low" }), // no data
      makeBin({ confidence: "medium", expectedRate: 0.6, actualRate: 0.6, total: 10, gap: 0 }),
      makeBin({ confidence: "high", expectedRate: 0.8, actualRate: 0.8, total: 10, gap: 0 }),
    ];

    // 완벽히 캘리브레이션된 경우 ECE = 0
    expect(calcECE(bins)).toBe(0);
  });
});

// ─── calcCalibrationBins (DB 연동) ──────────────────────────────────────────

describe("calcCalibrationBins", () => {
  it("DB 결과를 CalibrationBin으로 변환한다", async () => {
    mockGroupBy.mockResolvedValueOnce([
      { confidence: "high", confirmed: 8, invalidated: 2 },
      { confidence: "medium", confirmed: 5, invalidated: 5 },
      { confidence: "low", confirmed: 2, invalidated: 3 },
    ]);

    const bins = await calcCalibrationBins();

    expect(bins).toHaveLength(3);

    const high = bins.find((b) => b.confidence === "high")!;
    expect(high.actualRate).toBe(0.8);
    expect(high.gap).toBeCloseTo(0); // 0.8 - 0.8 = 완벽 캘리브레이션

    const low = bins.find((b) => b.confidence === "low")!;
    expect(low.actualRate).toBe(0.4);
    expect(low.gap).toBeCloseTo(0); // 0.4 - 0.4 = 완벽 캘리브레이션
  });

  it("빈 결과 시 모든 레벨이 0건으로 반환", async () => {
    mockGroupBy.mockResolvedValueOnce([]);

    const bins = await calcCalibrationBins();

    expect(bins).toHaveLength(3);
    expect(bins.every((b) => b.total === 0)).toBe(true);
  });
});

// ─── getCalibrationResult ───────────────────────────────────────────────────

describe("getCalibrationResult", () => {
  it("충분한 데이터가 있으면 hasSufficientData=true", async () => {
    mockGroupBy.mockResolvedValueOnce([
      { confidence: "high", confirmed: 10, invalidated: 5 },
      { confidence: "medium", confirmed: 4, invalidated: 6 },
    ]);

    const result = await getCalibrationResult();

    expect(result.totalResolved).toBe(25);
    expect(result.hasSufficientData).toBe(true);
    expect(result.ece).not.toBeNull();
  });

  it("20건 미만이면 hasSufficientData=false", async () => {
    mockGroupBy.mockResolvedValueOnce([
      { confidence: "high", confirmed: 3, invalidated: 1 },
    ]);

    const result = await getCalibrationResult();

    expect(result.totalResolved).toBe(4);
    expect(result.hasSufficientData).toBe(false);
  });
});

// ─── generateFeedback ───────────────────────────────────────────────────────

describe("generateFeedback", () => {
  it("과신 구간에 대해 경고를 생성한다", () => {
    const bins: CalibrationBin[] = [
      makeBin({ confidence: "high", expectedRate: 0.8, actualRate: 0.5, total: 10, gap: 0.3 }),
    ];

    const feedback = generateFeedback(bins);

    expect(feedback).toHaveLength(1);
    expect(feedback[0]).toContain("HIGH 과신 경고");
    expect(feedback[0]).toContain("50%");
  });

  it("과소확신 구간에 대해 피드백을 생성한다", () => {
    const bins: CalibrationBin[] = [
      makeBin({ confidence: "low", expectedRate: 0.4, actualRate: 0.7, total: 10, gap: -0.3 }),
    ];

    const feedback = generateFeedback(bins);

    expect(feedback).toHaveLength(1);
    expect(feedback[0]).toContain("LOW 과소확신");
  });

  it("gap 10%p 이내면 피드백 없음", () => {
    const bins: CalibrationBin[] = [
      makeBin({ confidence: "high", expectedRate: 0.8, actualRate: 0.75, total: 10, gap: 0.05 }),
    ];

    expect(generateFeedback(bins)).toHaveLength(0);
  });

  it("데이터 3건 미만이면 피드백 생략", () => {
    const bins: CalibrationBin[] = [
      makeBin({ confidence: "high", expectedRate: 0.8, actualRate: 0.2, total: 2, gap: 0.6 }),
    ];

    expect(generateFeedback(bins)).toHaveLength(0);
  });
});

// ─── formatCalibrationForPrompt ─────────────────────────────────────────────

describe("formatCalibrationForPrompt", () => {
  const makeResult = (overrides?: Partial<CalibrationResult>): CalibrationResult => ({
    bins: [
      makeBin({ confidence: "low", expectedRate: 0.4, actualRate: 0.5, confirmed: 5, invalidated: 5, total: 10, gap: -0.1 }),
      makeBin({ confidence: "medium", expectedRate: 0.6, actualRate: 0.4, confirmed: 4, invalidated: 6, total: 10, gap: 0.2 }),
      makeBin({ confidence: "high", expectedRate: 0.8, actualRate: 0.6, confirmed: 6, invalidated: 4, total: 10, gap: 0.2 }),
    ],
    ece: 0.17,
    totalResolved: 30,
    hasSufficientData: true,
    ...overrides,
  });

  it("데이터 부족 시 빈 문자열 반환", () => {
    const result = makeResult({ hasSufficientData: false });
    expect(formatCalibrationForPrompt(result)).toBe("");
  });

  it("헤더와 캘리브레이션 테이블을 포함한다", () => {
    const output = formatCalibrationForPrompt(makeResult());
    expect(output).toContain("## Thesis Confidence 캘리브레이션");
    expect(output).toContain("ECE");
    expect(output).toContain("17.0%");
    expect(output).toContain("보정 필요");
    expect(output).toContain("HIGH");
    expect(output).toContain("MED");
    expect(output).toContain("LOW");
  });

  it("ECE < 0.1이면 '양호' 표시", () => {
    const output = formatCalibrationForPrompt(makeResult({ ece: 0.05 }));
    expect(output).toContain("양호");
  });

  it("ECE < 0.15이면 '보통' 표시", () => {
    const output = formatCalibrationForPrompt(makeResult({ ece: 0.12 }));
    expect(output).toContain("보통");
  });

  it("과신 구간에 대한 보정 지침을 포함한다", () => {
    const output = formatCalibrationForPrompt(makeResult());
    expect(output).toContain("보정 지침");
    expect(output).toContain("과신 경고");
  });

  it("완벽 캘리브레이션 시 보정 지침 없음", () => {
    const perfectResult = makeResult({
      bins: [
        makeBin({ confidence: "low", expectedRate: 0.4, actualRate: 0.4, confirmed: 4, invalidated: 6, total: 10, gap: 0 }),
        makeBin({ confidence: "medium", expectedRate: 0.6, actualRate: 0.6, confirmed: 6, invalidated: 4, total: 10, gap: 0 }),
        makeBin({ confidence: "high", expectedRate: 0.8, actualRate: 0.8, confirmed: 8, invalidated: 2, total: 10, gap: 0 }),
      ],
      ece: 0,
    });
    const output = formatCalibrationForPrompt(perfectResult);
    expect(output).not.toContain("보정 지침");
  });
});
