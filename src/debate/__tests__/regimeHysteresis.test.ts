import { describe, it, expect, vi, beforeEach } from "vitest";
import type { MarketRegimeRow } from "../regimeStore.js";

// ─── DB 모킹 ─────────────────────────────────────────────────────────────────

// select 체이닝 빌더
function makeSelectChain(rows: unknown[]) {
  return {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(rows),
  };
}

// update 체이닝 빌더
function makeUpdateChain() {
  return {
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue(undefined),
  };
}

// Drizzle db 클라이언트 모킹
vi.mock("@/db/client", () => ({
  db: {
    select: vi.fn(),
    update: vi.fn(),
    insert: vi.fn(),
  },
}));

// drizzle-orm 헬퍼 모킹 (단순 passthrough)
vi.mock("drizzle-orm", () => ({
  desc: (col: unknown) => col,
  eq: (col: unknown, val: unknown) => ({ col, val }),
  gte: (col: unknown, val: unknown) => ({ col, val }),
  lte: (col: unknown, val: unknown) => ({ col, val }),
  and: (...args: unknown[]) => args,
  sql: (str: unknown) => str,
}));

// schema 모킹
vi.mock("@/db/schema/analyst", () => ({
  marketRegimes: {
    regimeDate: "regime_date",
    regime: "regime",
    rationale: "rationale",
    confidence: "confidence",
    isConfirmed: "is_confirmed",
    confirmedAt: "confirmed_at",
  },
}));

// logger 모킹 (출력 억제)
vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// ─── 모킹 후 대상 모듈 import ─────────────────────────────────────────────────
import { db } from "@/db/client";
import {
  validateRegimeInput,
  formatRegimeForPrompt,
  applyHysteresis,
  loadConfirmedRegime,
  loadRecentRegimes,
  loadPendingRegimes,
} from "../regimeStore.js";

// ─── 픽스처 ───────────────────────────────────────────────────────────────────

function makeRow(
  overrides: Partial<MarketRegimeRow> = {},
): MarketRegimeRow {
  return {
    regimeDate: "2026-03-14",
    regime: "MID_BULL",
    rationale: "테스트 근거",
    confidence: "medium",
    isConfirmed: true,
    confirmedAt: "2026-03-14",
    ...overrides,
  };
}

// ─── validateRegimeInput ──────────────────────────────────────────────────────

describe("validateRegimeInput", () => {
  it("유효한 입력이면 정규화된 객체를 반환한다", () => {
    const raw = {
      regime: "MID_BULL",
      rationale: "상승 국면 유지",
      confidence: "high",
    };
    const result = validateRegimeInput(raw);
    expect(result).not.toBeNull();
    expect(result?.regime).toBe("MID_BULL");
    expect(result?.confidence).toBe("high");
  });

  it("null 입력이면 null을 반환한다", () => {
    expect(validateRegimeInput(null)).toBeNull();
  });

  it("유효하지 않은 regime이면 null을 반환한다", () => {
    expect(
      validateRegimeInput({ regime: "UNKNOWN", rationale: "근거", confidence: "low" }),
    ).toBeNull();
  });

  it("rationale이 비어 있으면 null을 반환한다", () => {
    expect(
      validateRegimeInput({ regime: "MID_BULL", rationale: "", confidence: "low" }),
    ).toBeNull();
  });

  it("confidence가 유효하지 않으면 low로 fallback된다", () => {
    const result = validateRegimeInput({
      regime: "EARLY_BULL",
      rationale: "근거",
      confidence: "invalid",
    });
    expect(result?.confidence).toBe("low");
  });
});

// ─── formatRegimeForPrompt ────────────────────────────────────────────────────

describe("formatRegimeForPrompt", () => {
  it("confirmed와 pending 모두 없으면 빈 문자열을 반환한다", () => {
    expect(formatRegimeForPrompt([])).toBe("");
  });

  it("confirmed 레짐이 있으면 현재 확정 레짐을 표시한다", () => {
    const rows = [makeRow({ regime: "MID_BULL", isConfirmed: true })];
    const result = formatRegimeForPrompt(rows);
    expect(result).toContain("현재 확정 레짐: MID_BULL");
    expect(result).toContain("중기 강세");
  });

  it("pending이 있으면 pending 섹션이 표시된다", () => {
    const confirmed = [makeRow({ regime: "MID_BULL", isConfirmed: true })];
    const pending = [makeRow({ regime: "EARLY_BEAR", isConfirmed: false, regimeDate: "2026-03-15" })];
    const result = formatRegimeForPrompt(confirmed, pending);
    expect(result).toContain("pending 판정");
    expect(result).toContain("EARLY_BEAR");
  });

  it("confirmed가 없고 pending만 있어도 레짐 없음을 표시한다", () => {
    const pending = [makeRow({ regime: "EARLY_BEAR", isConfirmed: false })];
    const result = formatRegimeForPrompt([], pending);
    expect(result).toContain("현재 확정 레짐: 없음");
    expect(result).toContain("pending 판정");
  });

  it("confirmed 히스토리가 2개 이상이면 히스토리 섹션이 표시된다", () => {
    const rows = [
      makeRow({ regimeDate: "2026-03-14", regime: "MID_BULL", isConfirmed: true }),
      makeRow({ regimeDate: "2026-03-13", regime: "EARLY_BULL", isConfirmed: true }),
    ];
    const result = formatRegimeForPrompt(rows);
    expect(result).toContain("최근 확정 레짐 히스토리");
    expect(result).toContain("2026-03-13: EARLY_BULL");
  });
});

// ─── applyHysteresis ─────────────────────────────────────────────────────────

describe("applyHysteresis", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * select 호출 순서 (수정된 구현 기준):
   *   1st: loadConfirmedRegime (is_confirmed = true 최신 1건)
   *   2nd: pending 윈도우 조회 (is_confirmed = false, date 범위 필터)
   */

  it("초기 상태(confirmed 없음)에서 pending 1건 → 즉시 확정", async () => {
    const pendingRow = makeRow({
      regimeDate: "2026-03-14",
      regime: "MID_BULL",
      isConfirmed: false,
      confirmedAt: null,
    });

    const selectCallbacks = [
      [],           // 1st: loadConfirmedRegime → 없음 (초기 상태)
      [pendingRow], // 2nd: pending 윈도우 → 1건
    ];
    let selectCallCount = 0;

    vi.mocked(db.select).mockImplementation(() => {
      const rows = selectCallbacks[selectCallCount] ?? [];
      selectCallCount++;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return makeSelectChain(rows) as any;
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(db.update).mockReturnValue(makeUpdateChain() as any);

    const result = await applyHysteresis("2026-03-14");

    expect(result).not.toBeNull();
    expect(result?.regime).toBe("MID_BULL");
    expect(result?.isConfirmed).toBe(true);
    expect(db.update).toHaveBeenCalled();
  });

  it("초기 상태에서 EARLY_BEAR pending 1건만으로도 즉시 확정된다 — Bear 레짐도 예외 없음", async () => {
    // 초기 상태(confirmed 없음)에서는 레짐 종류에 관계없이 pending 1건이면 즉시 확정
    const pendingRow = makeRow({
      regimeDate: "2026-03-14",
      regime: "EARLY_BEAR",
      isConfirmed: false,
      confirmedAt: null,
    });

    const selectCallbacks = [
      [],           // 1st: loadConfirmedRegime → 없음 (초기 상태)
      [pendingRow], // 2nd: pending 윈도우 → 1건
    ];
    let selectCallCount = 0;

    vi.mocked(db.select).mockImplementation(() => {
      const rows = selectCallbacks[selectCallCount] ?? [];
      selectCallCount++;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return makeSelectChain(rows) as any;
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(db.update).mockReturnValue(makeUpdateChain() as any);

    const result = await applyHysteresis("2026-03-14");

    expect(result).not.toBeNull();
    expect(result?.regime).toBe("EARLY_BEAR");
    expect(result?.isConfirmed).toBe(true);
    expect(db.update).toHaveBeenCalled();
  });

  it("운영 중(confirmed 존재) pending 1건만 있으면 확정되지 않는다", async () => {
    const pendingRow = makeRow({
      regimeDate: "2026-03-14",
      regime: "EARLY_BEAR",
      isConfirmed: false,
      confirmedAt: null,
    });
    const prevConfirmed = makeRow({
      regimeDate: "2026-03-13",
      regime: "MID_BULL",
      isConfirmed: true,
      confirmedAt: "2026-03-13",
    });

    const selectCallbacks = [
      [prevConfirmed], // 1st: loadConfirmedRegime → 기존 confirmed 있음
      [pendingRow],    // 2nd: pending 윈도우 → 1건만 (CONFIRMATION_DAYS=3 미충족)
    ];
    let selectCallCount = 0;

    vi.mocked(db.select).mockImplementation(() => {
      const rows = selectCallbacks[selectCallCount] ?? [];
      selectCallCount++;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return makeSelectChain(rows) as any;
    });

    const result = await applyHysteresis("2026-03-14");

    // 운영 중에는 1건으로 즉시 확정 안 됨 — 이전 confirmed 반환
    expect(result?.regime).toBe("MID_BULL");
    expect(db.update).not.toHaveBeenCalled();
  });

  it("pending이 0건이면 confirmed 레짐을 반환한다", async () => {
    const prevConfirmed = makeRow({
      regimeDate: "2026-03-12",
      regime: "MID_BULL",
      isConfirmed: true,
      confirmedAt: "2026-03-12",
    });

    const selectCallbacks = [
      [prevConfirmed], // 1st: loadConfirmedRegime
      [],              // 2nd: pending 윈도우 → 0건
    ];
    let selectCallCount = 0;

    vi.mocked(db.select).mockImplementation(() => {
      const rows = selectCallbacks[selectCallCount] ?? [];
      selectCallCount++;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return makeSelectChain(rows) as any;
    });

    const result = await applyHysteresis("2026-03-14");
    expect(result?.regime).toBe("MID_BULL");
    expect(db.update).not.toHaveBeenCalled();
  });

  it("high confidence 5일 연속 동일 레짐 → 확정된다", async () => {
    const day1 = makeRow({ regimeDate: "2026-03-10", regime: "EARLY_BEAR", confidence: "high", isConfirmed: false, confirmedAt: null });
    const day2 = makeRow({ regimeDate: "2026-03-11", regime: "EARLY_BEAR", confidence: "high", isConfirmed: false, confirmedAt: null });
    const day3 = makeRow({ regimeDate: "2026-03-12", regime: "EARLY_BEAR", confidence: "high", isConfirmed: false, confirmedAt: null });
    const day4 = makeRow({ regimeDate: "2026-03-13", regime: "EARLY_BEAR", confidence: "high", isConfirmed: false, confirmedAt: null });
    const day5 = makeRow({ regimeDate: "2026-03-14", regime: "EARLY_BEAR", confidence: "high", isConfirmed: false, confirmedAt: null });
    const prevConfirmed = makeRow({ regimeDate: "2026-02-25", regime: "MID_BULL", isConfirmed: true, confirmedAt: "2026-02-25" });

    const selectCallbacks = [
      [prevConfirmed],                        // 1st: loadConfirmedRegime
      [day5, day4, day3, day2, day1],         // 2nd: pending 윈도우 — 최신순, 5건
    ];
    let selectCallCount = 0;

    vi.mocked(db.select).mockImplementation(() => {
      const rows = selectCallbacks[selectCallCount] ?? [];
      selectCallCount++;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return makeSelectChain(rows) as any;
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(db.update).mockReturnValue(makeUpdateChain() as any);

    const result = await applyHysteresis("2026-03-14");

    expect(result).not.toBeNull();
    expect(result?.regime).toBe("EARLY_BEAR");
    expect(result?.isConfirmed).toBe(true);
    expect(db.update).toHaveBeenCalled();
  });

  it("high confidence 4일 연속 → 확정 안 됨 (5일 미충족)", async () => {
    const day1 = makeRow({ regimeDate: "2026-03-11", regime: "EARLY_BEAR", confidence: "high", isConfirmed: false, confirmedAt: null });
    const day2 = makeRow({ regimeDate: "2026-03-12", regime: "EARLY_BEAR", confidence: "high", isConfirmed: false, confirmedAt: null });
    const day3 = makeRow({ regimeDate: "2026-03-13", regime: "EARLY_BEAR", confidence: "high", isConfirmed: false, confirmedAt: null });
    const day4 = makeRow({ regimeDate: "2026-03-14", regime: "EARLY_BEAR", confidence: "high", isConfirmed: false, confirmedAt: null });
    const prevConfirmed = makeRow({ regimeDate: "2026-03-10", regime: "MID_BULL", isConfirmed: true, confirmedAt: "2026-03-10" });

    const selectCallbacks = [
      [prevConfirmed], // 1st: loadConfirmedRegime
      [day4, day3, day2, day1],    // 2nd: pending 윈도우 — 4건만 (5일 미충족)
    ];
    let selectCallCount = 0;

    vi.mocked(db.select).mockImplementation(() => {
      const rows = selectCallbacks[selectCallCount] ?? [];
      selectCallCount++;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return makeSelectChain(rows) as any;
    });

    const result = await applyHysteresis("2026-03-14");

    expect(result?.regime).toBe("MID_BULL");
    expect(db.update).not.toHaveBeenCalled();
  });

  it("비연속 날짜 pending → 확정 안 됨", async () => {
    // MAX_GAP_DAYS = 4이므로 5일 이상 차이를 "비연속"으로 테스트한다.
    // 2026-03-17(화)과 2026-03-11(수)은 달력 기준 6일 차이 → 비연속
    const day1 = makeRow({ regimeDate: "2026-03-11", regime: "EARLY_BEAR", isConfirmed: false, confirmedAt: null });
    const day2 = makeRow({ regimeDate: "2026-03-17", regime: "EARLY_BEAR", isConfirmed: false, confirmedAt: null });
    const prevConfirmed = makeRow({ regimeDate: "2026-03-10", regime: "MID_BULL", isConfirmed: true, confirmedAt: "2026-03-10" });

    const selectCallbacks = [
      [prevConfirmed], // 1st: loadConfirmedRegime
      [day2, day1],    // 2nd: pending 윈도우 — 동일 레짐이지만 날짜 비연속 (6일 차이)
    ];
    let selectCallCount = 0;

    vi.mocked(db.select).mockImplementation(() => {
      const rows = selectCallbacks[selectCallCount] ?? [];
      selectCallCount++;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return makeSelectChain(rows) as any;
    });

    const result = await applyHysteresis("2026-03-17");

    // 날짜가 연속이 아니므로 확정 불가 — 이전 confirmed 반환
    expect(result?.regime).toBe("MID_BULL");
    expect(db.update).not.toHaveBeenCalled();
  });

  it("2일 중 레짐이 다르면 확정되지 않는다 — 이전 확정 레짐 반환", async () => {
    const day1 = makeRow({ regimeDate: "2026-03-13", regime: "MID_BULL", isConfirmed: false, confirmedAt: null });
    const day2 = makeRow({ regimeDate: "2026-03-14", regime: "EARLY_BEAR", isConfirmed: false, confirmedAt: null });
    const prevConfirmed = makeRow({ regimeDate: "2026-03-12", regime: "MID_BULL", isConfirmed: true, confirmedAt: "2026-03-12" });

    const selectCallbacks = [
      [prevConfirmed], // 1st: loadConfirmedRegime
      [day2, day1],    // 2nd: pending 윈도우 — 레짐 불일치
    ];
    let selectCallCount = 0;

    vi.mocked(db.select).mockImplementation(() => {
      const rows = selectCallbacks[selectCallCount] ?? [];
      selectCallCount++;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return makeSelectChain(rows) as any;
    });

    const result = await applyHysteresis("2026-03-14");

    expect(result?.regime).toBe("MID_BULL");
    expect(db.update).not.toHaveBeenCalled();
  });

  it("레짐 A 확정 후 레짐 B가 high confidence 5일 연속 → B로 전환 확정", async () => {
    // 레짐 A(MID_BULL)가 확정된 상태에서 B(EARLY_BEAR)가 high confidence 5일 연속 pending
    const earlyBearDay1 = makeRow({ regimeDate: "2026-03-10", regime: "EARLY_BEAR", confidence: "high", isConfirmed: false, confirmedAt: null });
    const earlyBearDay2 = makeRow({ regimeDate: "2026-03-11", regime: "EARLY_BEAR", confidence: "high", isConfirmed: false, confirmedAt: null });
    const earlyBearDay3 = makeRow({ regimeDate: "2026-03-12", regime: "EARLY_BEAR", confidence: "high", isConfirmed: false, confirmedAt: null });
    const earlyBearDay4 = makeRow({ regimeDate: "2026-03-13", regime: "EARLY_BEAR", confidence: "high", isConfirmed: false, confirmedAt: null });
    const earlyBearDay5 = makeRow({ regimeDate: "2026-03-14", regime: "EARLY_BEAR", confidence: "high", isConfirmed: false, confirmedAt: null });
    const midBullConfirmed = makeRow({ regimeDate: "2026-02-25", regime: "MID_BULL", isConfirmed: true, confirmedAt: "2026-02-25" });

    const selectCallbacks = [
      [midBullConfirmed],                          // 1st: loadConfirmedRegime → MID_BULL confirmed
      [earlyBearDay5, earlyBearDay4, earlyBearDay3, earlyBearDay2, earlyBearDay1], // 2nd: pending 5건 — EARLY_BEAR 연속
    ];
    let selectCallCount = 0;

    vi.mocked(db.select).mockImplementation(() => {
      const rows = selectCallbacks[selectCallCount] ?? [];
      selectCallCount++;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return makeSelectChain(rows) as any;
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(db.update).mockReturnValue(makeUpdateChain() as any);

    const result = await applyHysteresis("2026-03-14");

    expect(result?.regime).toBe("EARLY_BEAR");
    expect(result?.isConfirmed).toBe(true);
    expect(db.update).toHaveBeenCalled();
  });

  it("허용 전환(LATE_BULL → EARLY_BEAR) high confidence 5일 연속 → 확정됨", async () => {
    // LATE_BULL → EARLY_BEAR는 ALLOWED_TRANSITIONS에 포함된 허용 전환
    const day1 = makeRow({ regimeDate: "2026-03-10", regime: "EARLY_BEAR", confidence: "high", isConfirmed: false, confirmedAt: null });
    const day2 = makeRow({ regimeDate: "2026-03-11", regime: "EARLY_BEAR", confidence: "high", isConfirmed: false, confirmedAt: null });
    const day3 = makeRow({ regimeDate: "2026-03-12", regime: "EARLY_BEAR", confidence: "high", isConfirmed: false, confirmedAt: null });
    const day4 = makeRow({ regimeDate: "2026-03-13", regime: "EARLY_BEAR", confidence: "high", isConfirmed: false, confirmedAt: null });
    const day5 = makeRow({ regimeDate: "2026-03-14", regime: "EARLY_BEAR", confidence: "high", isConfirmed: false, confirmedAt: null });
    const lateBullConfirmed = makeRow({ regimeDate: "2026-02-25", regime: "LATE_BULL", isConfirmed: true, confirmedAt: "2026-02-25" });

    const selectCallbacks = [
      [lateBullConfirmed],                        // 1st: loadConfirmedRegime → LATE_BULL confirmed
      [day5, day4, day3, day2, day1],             // 2nd: pending 5건 — EARLY_BEAR 연속
    ];
    let selectCallCount = 0;

    vi.mocked(db.select).mockImplementation(() => {
      const rows = selectCallbacks[selectCallCount] ?? [];
      selectCallCount++;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return makeSelectChain(rows) as any;
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(db.update).mockReturnValue(makeUpdateChain() as any);

    const result = await applyHysteresis("2026-03-14");

    expect(result?.regime).toBe("EARLY_BEAR");
    expect(result?.isConfirmed).toBe(true);
    expect(db.update).toHaveBeenCalled();
  });

  it("금지 전환(LATE_BULL → EARLY_BULL) high confidence 5일 연속 → 확정 거부, 이전 confirmed 반환", async () => {
    // LATE_BULL → EARLY_BULL은 ALLOWED_TRANSITIONS에 없는 금지 전환
    const day1 = makeRow({ regimeDate: "2026-03-10", regime: "EARLY_BULL", confidence: "high", isConfirmed: false, confirmedAt: null });
    const day2 = makeRow({ regimeDate: "2026-03-11", regime: "EARLY_BULL", confidence: "high", isConfirmed: false, confirmedAt: null });
    const day3 = makeRow({ regimeDate: "2026-03-12", regime: "EARLY_BULL", confidence: "high", isConfirmed: false, confirmedAt: null });
    const day4 = makeRow({ regimeDate: "2026-03-13", regime: "EARLY_BULL", confidence: "high", isConfirmed: false, confirmedAt: null });
    const day5 = makeRow({ regimeDate: "2026-03-14", regime: "EARLY_BULL", confidence: "high", isConfirmed: false, confirmedAt: null });
    const lateBullConfirmed = makeRow({ regimeDate: "2026-02-25", regime: "LATE_BULL", isConfirmed: true, confirmedAt: "2026-02-25" });

    const selectCallbacks = [
      [lateBullConfirmed],                        // 1st: loadConfirmedRegime → LATE_BULL confirmed
      [day5, day4, day3, day2, day1],             // 2nd: pending 5건 — EARLY_BULL 연속 (금지 전환)
    ];
    let selectCallCount = 0;

    vi.mocked(db.select).mockImplementation(() => {
      const rows = selectCallbacks[selectCallCount] ?? [];
      selectCallCount++;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return makeSelectChain(rows) as any;
    });

    const result = await applyHysteresis("2026-03-14");

    // 금지 전환이므로 확정 거부 — 이전 confirmed(LATE_BULL) 반환
    expect(result?.regime).toBe("LATE_BULL");
    expect(db.update).not.toHaveBeenCalled();
  });

  it("허용 전환(EARLY_BEAR → EARLY_BULL) high confidence 5일 연속 → 확정됨", async () => {
    // EARLY_BEAR → EARLY_BULL은 약세 회복 경로 — ALLOWED_TRANSITIONS에 포함
    const day1 = makeRow({ regimeDate: "2026-03-20", regime: "EARLY_BULL", confidence: "high", isConfirmed: false, confirmedAt: null });
    const day2 = makeRow({ regimeDate: "2026-03-21", regime: "EARLY_BULL", confidence: "high", isConfirmed: false, confirmedAt: null });
    const day3 = makeRow({ regimeDate: "2026-03-24", regime: "EARLY_BULL", confidence: "high", isConfirmed: false, confirmedAt: null });
    const day4 = makeRow({ regimeDate: "2026-03-25", regime: "EARLY_BULL", confidence: "high", isConfirmed: false, confirmedAt: null });
    const day5 = makeRow({ regimeDate: "2026-03-26", regime: "EARLY_BULL", confidence: "high", isConfirmed: false, confirmedAt: null });
    const earlyBearConfirmed = makeRow({ regimeDate: "2026-03-01", regime: "EARLY_BEAR", isConfirmed: true, confirmedAt: "2026-03-01" });

    const selectCallbacks = [
      [earlyBearConfirmed],                       // 1st: loadConfirmedRegime → EARLY_BEAR confirmed
      [day5, day4, day3, day2, day1],             // 2nd: pending 5건 — EARLY_BULL 연속 (허용 전환)
    ];
    let selectCallCount = 0;

    vi.mocked(db.select).mockImplementation(() => {
      const rows = selectCallbacks[selectCallCount] ?? [];
      selectCallCount++;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return makeSelectChain(rows) as any;
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(db.update).mockReturnValue(makeUpdateChain() as any);

    const result = await applyHysteresis("2026-03-26");

    expect(result?.regime).toBe("EARLY_BULL");
    expect(result?.isConfirmed).toBe(true);
    expect(db.update).toHaveBeenCalled();
  });

  it("금지 전환(EARLY_BEAR → LATE_BULL) high confidence 5일 연속 → 확정 거부", async () => {
    // EARLY_BEAR → LATE_BULL은 2단계 건너뛰기 — ALLOWED_TRANSITIONS에서 제거됨
    const day1 = makeRow({ regimeDate: "2026-03-20", regime: "LATE_BULL", confidence: "high", isConfirmed: false, confirmedAt: null });
    const day2 = makeRow({ regimeDate: "2026-03-21", regime: "LATE_BULL", confidence: "high", isConfirmed: false, confirmedAt: null });
    const day3 = makeRow({ regimeDate: "2026-03-24", regime: "LATE_BULL", confidence: "high", isConfirmed: false, confirmedAt: null });
    const day4 = makeRow({ regimeDate: "2026-03-25", regime: "LATE_BULL", confidence: "high", isConfirmed: false, confirmedAt: null });
    const day5 = makeRow({ regimeDate: "2026-03-26", regime: "LATE_BULL", confidence: "high", isConfirmed: false, confirmedAt: null });
    const earlyBearConfirmed = makeRow({ regimeDate: "2026-03-01", regime: "EARLY_BEAR", isConfirmed: true, confirmedAt: "2026-03-01" });

    const selectCallbacks = [
      [earlyBearConfirmed],                       // 1st: loadConfirmedRegime → EARLY_BEAR confirmed
      [day5, day4, day3, day2, day1],             // 2nd: pending 5건 — LATE_BULL 연속 (금지 전환)
    ];
    let selectCallCount = 0;

    vi.mocked(db.select).mockImplementation(() => {
      const rows = selectCallbacks[selectCallCount] ?? [];
      selectCallCount++;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return makeSelectChain(rows) as any;
    });

    const result = await applyHysteresis("2026-03-26");

    // 금지 전환이므로 확정 거부 — 이전 confirmed(EARLY_BEAR) 반환
    expect(result?.regime).toBe("EARLY_BEAR");
    expect(db.update).not.toHaveBeenCalled();
  });

  it("초기 상태에서 금지 전환도 허용 — confirmed 없으면 제약 미적용", async () => {
    // confirmed가 없으면 ALLOWED_TRANSITIONS 제약 없이 첫 확정 허용
    const day1 = makeRow({ regimeDate: "2026-03-12", regime: "EARLY_BULL", isConfirmed: false, confirmedAt: null });
    const day2 = makeRow({ regimeDate: "2026-03-13", regime: "EARLY_BULL", isConfirmed: false, confirmedAt: null });
    const day3 = makeRow({ regimeDate: "2026-03-14", regime: "EARLY_BULL", isConfirmed: false, confirmedAt: null });

    const selectCallbacks = [
      [],                    // 1st: loadConfirmedRegime → 없음 (초기 상태)
      [day3, day2, day1],    // 2nd: pending 3건
    ];
    let selectCallCount = 0;

    vi.mocked(db.select).mockImplementation(() => {
      const rows = selectCallbacks[selectCallCount] ?? [];
      selectCallCount++;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return makeSelectChain(rows) as any;
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(db.update).mockReturnValue(makeUpdateChain() as any);

    const result = await applyHysteresis("2026-03-14");

    // 초기 상태이므로 즉시 확정 (pending 1건이어도 확정, 3건은 더욱 확정)
    expect(result?.regime).toBe("EARLY_BULL");
    expect(result?.isConfirmed).toBe(true);
    expect(db.update).toHaveBeenCalled();
  });

  it("주말 포함 high confidence 5일 연속 → 확정", async () => {
    // 수→목→금→(주말)→월→화: 5거래일 연속, 주말 포함
    const wedPending = makeRow({ regimeDate: "2026-03-11", regime: "EARLY_BEAR", confidence: "high", isConfirmed: false, confirmedAt: null });
    const thuPending = makeRow({ regimeDate: "2026-03-12", regime: "EARLY_BEAR", confidence: "high", isConfirmed: false, confirmedAt: null });
    const friPending = makeRow({ regimeDate: "2026-03-13", regime: "EARLY_BEAR", confidence: "high", isConfirmed: false, confirmedAt: null });
    const monPending = makeRow({ regimeDate: "2026-03-16", regime: "EARLY_BEAR", confidence: "high", isConfirmed: false, confirmedAt: null });
    const tuePending = makeRow({ regimeDate: "2026-03-17", regime: "EARLY_BEAR", confidence: "high", isConfirmed: false, confirmedAt: null });
    const prevConfirmed = makeRow({ regimeDate: "2026-02-25", regime: "MID_BULL", isConfirmed: true, confirmedAt: "2026-02-25" });

    const selectCallbacks = [
      [prevConfirmed],                                                       // 1st: loadConfirmedRegime
      [tuePending, monPending, friPending, thuPending, wedPending],          // 2nd: pending 윈도우 — 5건
    ];
    let selectCallCount = 0;

    vi.mocked(db.select).mockImplementation(() => {
      const rows = selectCallbacks[selectCallCount] ?? [];
      selectCallCount++;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return makeSelectChain(rows) as any;
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(db.update).mockReturnValue(makeUpdateChain() as any);

    const result = await applyHysteresis("2026-03-17");

    // 주말을 사이에 두고도 연속 거래일로 인식 → 확정
    expect(result?.regime).toBe("EARLY_BEAR");
    expect(result?.isConfirmed).toBe(true);
    expect(db.update).toHaveBeenCalled();
  });

  it("쿨다운 기간 내 다른 레짐 전환 → 차단, 이전 confirmed 반환", async () => {
    // confirmedAt: 3/05, 처리일: 3/14 → 9일 차이 (< 14일 쿨다운)
    const day1 = makeRow({ regimeDate: "2026-03-10", regime: "EARLY_BEAR", confidence: "high", isConfirmed: false, confirmedAt: null });
    const day2 = makeRow({ regimeDate: "2026-03-11", regime: "EARLY_BEAR", confidence: "high", isConfirmed: false, confirmedAt: null });
    const day3 = makeRow({ regimeDate: "2026-03-12", regime: "EARLY_BEAR", confidence: "high", isConfirmed: false, confirmedAt: null });
    const day4 = makeRow({ regimeDate: "2026-03-13", regime: "EARLY_BEAR", confidence: "high", isConfirmed: false, confirmedAt: null });
    const day5 = makeRow({ regimeDate: "2026-03-14", regime: "EARLY_BEAR", confidence: "high", isConfirmed: false, confirmedAt: null });
    const recentConfirmed = makeRow({ regimeDate: "2026-03-05", regime: "MID_BULL", isConfirmed: true, confirmedAt: "2026-03-05" });

    const selectCallbacks = [
      [recentConfirmed],                          // 1st: loadConfirmedRegime → 최근 확정 (9일 전 < 14일 쿨다운)
      [day5, day4, day3, day2, day1],             // 2nd: pending 5건 — EARLY_BEAR 연속
    ];
    let selectCallCount = 0;

    vi.mocked(db.select).mockImplementation(() => {
      const rows = selectCallbacks[selectCallCount] ?? [];
      selectCallCount++;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return makeSelectChain(rows) as any;
    });

    const result = await applyHysteresis("2026-03-14");

    // 쿨다운 기간 내이므로 전환 차단 — 이전 confirmed(MID_BULL) 반환
    expect(result?.regime).toBe("MID_BULL");
    expect(db.update).not.toHaveBeenCalled();
  });

  it("쿨다운 경과 후 다른 레짐 high confidence 5일 연속 → 전환 확정", async () => {
    // confirmedAt: 2/25, 처리일: 3/14 → 17일 차이 (>= 14일 쿨다운)
    const day1 = makeRow({ regimeDate: "2026-03-10", regime: "EARLY_BEAR", confidence: "high", isConfirmed: false, confirmedAt: null });
    const day2 = makeRow({ regimeDate: "2026-03-11", regime: "EARLY_BEAR", confidence: "high", isConfirmed: false, confirmedAt: null });
    const day3 = makeRow({ regimeDate: "2026-03-12", regime: "EARLY_BEAR", confidence: "high", isConfirmed: false, confirmedAt: null });
    const day4 = makeRow({ regimeDate: "2026-03-13", regime: "EARLY_BEAR", confidence: "high", isConfirmed: false, confirmedAt: null });
    const day5 = makeRow({ regimeDate: "2026-03-14", regime: "EARLY_BEAR", confidence: "high", isConfirmed: false, confirmedAt: null });
    const oldConfirmed = makeRow({ regimeDate: "2026-02-25", regime: "MID_BULL", isConfirmed: true, confirmedAt: "2026-02-25" });

    const selectCallbacks = [
      [oldConfirmed],                             // 1st: loadConfirmedRegime → 17일 전 확정
      [day5, day4, day3, day2, day1],             // 2nd: pending 5건 — EARLY_BEAR 연속
    ];
    let selectCallCount = 0;

    vi.mocked(db.select).mockImplementation(() => {
      const rows = selectCallbacks[selectCallCount] ?? [];
      selectCallCount++;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return makeSelectChain(rows) as any;
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(db.update).mockReturnValue(makeUpdateChain() as any);

    const result = await applyHysteresis("2026-03-14");

    // 쿨다운 경과 → 전환 확정
    expect(result?.regime).toBe("EARLY_BEAR");
    expect(result?.isConfirmed).toBe(true);
    expect(db.update).toHaveBeenCalled();
  });

  it("동일 레짐 재확정은 쿨다운 무관 — 항상 허용", async () => {
    // confirmedAt: 3/09, 처리일: 3/14 → 5일 차이 (< 14일 쿨다운이지만 동일 레짐)
    const day1 = makeRow({ regimeDate: "2026-03-10", regime: "MID_BULL", confidence: "high", isConfirmed: false, confirmedAt: null });
    const day2 = makeRow({ regimeDate: "2026-03-11", regime: "MID_BULL", confidence: "high", isConfirmed: false, confirmedAt: null });
    const day3 = makeRow({ regimeDate: "2026-03-12", regime: "MID_BULL", confidence: "high", isConfirmed: false, confirmedAt: null });
    const day4 = makeRow({ regimeDate: "2026-03-13", regime: "MID_BULL", confidence: "high", isConfirmed: false, confirmedAt: null });
    const day5 = makeRow({ regimeDate: "2026-03-14", regime: "MID_BULL", confidence: "high", isConfirmed: false, confirmedAt: null });
    const recentConfirmed = makeRow({ regimeDate: "2026-03-09", regime: "MID_BULL", isConfirmed: true, confirmedAt: "2026-03-09" });

    const selectCallbacks = [
      [recentConfirmed],                          // 1st: loadConfirmedRegime → 최근 확정 동일 레짐
      [day5, day4, day3, day2, day1],             // 2nd: pending 5건 — 동일 레짐 MID_BULL 연속
    ];
    let selectCallCount = 0;

    vi.mocked(db.select).mockImplementation(() => {
      const rows = selectCallbacks[selectCallCount] ?? [];
      selectCallCount++;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return makeSelectChain(rows) as any;
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(db.update).mockReturnValue(makeUpdateChain() as any);

    const result = await applyHysteresis("2026-03-14");

    // 동일 레짐이므로 쿨다운 미적용 → 확정
    expect(result?.regime).toBe("MID_BULL");
    expect(result?.isConfirmed).toBe(true);
    expect(db.update).toHaveBeenCalled();
  });

  // ─── 스트레스 교차검증 (VIX/공포탐욕) ──────────────────────────────────────────

  it("VIX > 25 + 공포탐욕 < 25 → BULL 계열 확정 차단", async () => {
    // 초기 상태에서도 스트레스 차단 적용
    const pendingRow = makeRow({
      regimeDate: "2026-03-14",
      regime: "LATE_BULL",
      isConfirmed: false,
      confirmedAt: null,
    });

    const selectCallbacks = [
      [],           // 1st: loadConfirmedRegime → 없음 (초기 상태)
      [pendingRow], // 2nd: pending 윈도우 → 1건
    ];
    let selectCallCount = 0;

    vi.mocked(db.select).mockImplementation(() => {
      const rows = selectCallbacks[selectCallCount] ?? [];
      selectCallCount++;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return makeSelectChain(rows) as any;
    });

    const result = await applyHysteresis("2026-03-14", {
      vix: 27.29,
      fearGreedScore: 21.2,
    });

    // 스트레스 차단: VIX 27.29 > 25 AND 공포탐욕 21.2 < 25 → BULL 확정 불가
    expect(result).toBeNull();
    expect(db.update).not.toHaveBeenCalled();
  });

  it("VIX > 25 + 공포탐욕 > 25 → BULL 허용 (AND 조건 미충족)", async () => {
    const pendingRow = makeRow({
      regimeDate: "2026-03-14",
      regime: "EARLY_BULL",
      isConfirmed: false,
      confirmedAt: null,
    });

    const selectCallbacks = [
      [],           // 1st: loadConfirmedRegime → 없음 (초기 상태)
      [pendingRow], // 2nd: pending 윈도우 → 1건
    ];
    let selectCallCount = 0;

    vi.mocked(db.select).mockImplementation(() => {
      const rows = selectCallbacks[selectCallCount] ?? [];
      selectCallCount++;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return makeSelectChain(rows) as any;
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(db.update).mockReturnValue(makeUpdateChain() as any);

    const result = await applyHysteresis("2026-03-14", {
      vix: 28.0,
      fearGreedScore: 30.0, // 공포탐욕 > 25 → AND 조건 미충족
    });

    // 초기 상태 + AND 조건 미충족 → 즉시 확정
    expect(result?.regime).toBe("EARLY_BULL");
    expect(result?.isConfirmed).toBe(true);
    expect(db.update).toHaveBeenCalled();
  });

  it("VIX < 25 + 공포탐욕 < 25 → BULL 허용 (VIX 조건 미충족)", async () => {
    const pendingRow = makeRow({
      regimeDate: "2026-03-14",
      regime: "MID_BULL",
      isConfirmed: false,
      confirmedAt: null,
    });

    const selectCallbacks = [
      [],           // 1st: loadConfirmedRegime → 없음 (초기 상태)
      [pendingRow], // 2nd: pending 윈도우 → 1건
    ];
    let selectCallCount = 0;

    vi.mocked(db.select).mockImplementation(() => {
      const rows = selectCallbacks[selectCallCount] ?? [];
      selectCallCount++;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return makeSelectChain(rows) as any;
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(db.update).mockReturnValue(makeUpdateChain() as any);

    const result = await applyHysteresis("2026-03-14", {
      vix: 18.0, // VIX < 25 → 차단 안 됨
      fearGreedScore: 20.0,
    });

    expect(result?.regime).toBe("MID_BULL");
    expect(result?.isConfirmed).toBe(true);
    expect(db.update).toHaveBeenCalled();
  });

  it("BEAR 계열은 스트레스와 무관하게 확정", async () => {
    const pendingRow = makeRow({
      regimeDate: "2026-03-14",
      regime: "EARLY_BEAR",
      isConfirmed: false,
      confirmedAt: null,
    });

    const selectCallbacks = [
      [],           // 1st: loadConfirmedRegime → 없음 (초기 상태)
      [pendingRow], // 2nd: pending 윈도우 → 1건
    ];
    let selectCallCount = 0;

    vi.mocked(db.select).mockImplementation(() => {
      const rows = selectCallbacks[selectCallCount] ?? [];
      selectCallCount++;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return makeSelectChain(rows) as any;
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(db.update).mockReturnValue(makeUpdateChain() as any);

    const result = await applyHysteresis("2026-03-14", {
      vix: 35.0,
      fearGreedScore: 10.0,
    });

    // BEAR 계열은 스트레스 검증 대상 아님 → 즉시 확정
    expect(result?.regime).toBe("EARLY_BEAR");
    expect(result?.isConfirmed).toBe(true);
    expect(db.update).toHaveBeenCalled();
  });

  it("stressContext 없으면 게이트 미적용 — 하위 호환", async () => {
    const pendingRow = makeRow({
      regimeDate: "2026-03-14",
      regime: "LATE_BULL",
      isConfirmed: false,
      confirmedAt: null,
    });

    const selectCallbacks = [
      [],           // 1st: loadConfirmedRegime → 없음 (초기 상태)
      [pendingRow], // 2nd: pending 윈도우 → 1건
    ];
    let selectCallCount = 0;

    vi.mocked(db.select).mockImplementation(() => {
      const rows = selectCallbacks[selectCallCount] ?? [];
      selectCallCount++;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return makeSelectChain(rows) as any;
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(db.update).mockReturnValue(makeUpdateChain() as any);

    // stressContext 미전달 (기존 호출 패턴)
    const result = await applyHysteresis("2026-03-14");

    expect(result?.regime).toBe("LATE_BULL");
    expect(result?.isConfirmed).toBe(true);
    expect(db.update).toHaveBeenCalled();
  });

  it("stressContext에 vix만 있고 fearGreedScore null → 게이트 미적용", async () => {
    const pendingRow = makeRow({
      regimeDate: "2026-03-14",
      regime: "EARLY_BULL",
      isConfirmed: false,
      confirmedAt: null,
    });

    const selectCallbacks = [
      [],
      [pendingRow],
    ];
    let selectCallCount = 0;

    vi.mocked(db.select).mockImplementation(() => {
      const rows = selectCallbacks[selectCallCount] ?? [];
      selectCallCount++;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return makeSelectChain(rows) as any;
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(db.update).mockReturnValue(makeUpdateChain() as any);

    const result = await applyHysteresis("2026-03-14", {
      vix: 30.0,
      fearGreedScore: null, // 데이터 누락
    });

    // fearGreedScore null → AND 조건 평가 불가 → 게이트 미적용
    expect(result?.regime).toBe("EARLY_BULL");
    expect(result?.isConfirmed).toBe(true);
    expect(db.update).toHaveBeenCalled();
  });

  // ─── confidence-scaled dwell time (#520) ─────────────────────────────────────

  it("medium confidence 5일 연속 → 확정 안 됨 (7일 필요)", async () => {
    const days = Array.from({ length: 5 }, (_, i) =>
      makeRow({
        regimeDate: `2026-03-${String(10 + i).padStart(2, "0")}`,
        regime: "EARLY_BEAR",
        confidence: "medium",
        isConfirmed: false,
        confirmedAt: null,
      }),
    ).reverse(); // DESC: 최신 → 과거

    const prevConfirmed = makeRow({
      regimeDate: "2026-02-20",
      regime: "MID_BULL",
      isConfirmed: true,
      confirmedAt: "2026-02-20",
    });

    const selectCallbacks = [
      [prevConfirmed],
      days,
    ];
    let selectCallCount = 0;

    vi.mocked(db.select).mockImplementation(() => {
      const rows = selectCallbacks[selectCallCount] ?? [];
      selectCallCount++;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return makeSelectChain(rows) as any;
    });

    const result = await applyHysteresis("2026-03-14");

    // medium confidence → 7일 필요, 5일로는 부족
    expect(result?.regime).toBe("MID_BULL");
    expect(db.update).not.toHaveBeenCalled();
  });

  it("medium confidence 7일 연속 → 확정됨", async () => {
    const days = Array.from({ length: 7 }, (_, i) =>
      makeRow({
        regimeDate: `2026-03-${String(10 + i).padStart(2, "0")}`,
        regime: "EARLY_BEAR",
        confidence: "medium",
        isConfirmed: false,
        confirmedAt: null,
      }),
    ).reverse(); // DESC: 최신 → 과거

    const prevConfirmed = makeRow({
      regimeDate: "2026-02-20",
      regime: "MID_BULL",
      isConfirmed: true,
      confirmedAt: "2026-02-20",
    });

    const selectCallbacks = [
      [prevConfirmed],
      days,
    ];
    let selectCallCount = 0;

    vi.mocked(db.select).mockImplementation(() => {
      const rows = selectCallbacks[selectCallCount] ?? [];
      selectCallCount++;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return makeSelectChain(rows) as any;
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(db.update).mockReturnValue(makeUpdateChain() as any);

    const result = await applyHysteresis("2026-03-16");

    // medium confidence 7일 연속 → 확정
    expect(result?.regime).toBe("EARLY_BEAR");
    expect(result?.isConfirmed).toBe(true);
    expect(db.update).toHaveBeenCalled();
  });

  it("high confidence 5일 연속 → 기존처럼 확정됨", async () => {
    const days = Array.from({ length: 5 }, (_, i) =>
      makeRow({
        regimeDate: `2026-03-${String(10 + i).padStart(2, "0")}`,
        regime: "EARLY_BEAR",
        confidence: "high",
        isConfirmed: false,
        confirmedAt: null,
      }),
    ).reverse();

    const prevConfirmed = makeRow({
      regimeDate: "2026-02-20",
      regime: "MID_BULL",
      isConfirmed: true,
      confirmedAt: "2026-02-20",
    });

    const selectCallbacks = [
      [prevConfirmed],
      days,
    ];
    let selectCallCount = 0;

    vi.mocked(db.select).mockImplementation(() => {
      const rows = selectCallbacks[selectCallCount] ?? [];
      selectCallCount++;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return makeSelectChain(rows) as any;
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(db.update).mockReturnValue(makeUpdateChain() as any);

    const result = await applyHysteresis("2026-03-14");

    // high confidence 5일 → 기존 동작대로 확정
    expect(result?.regime).toBe("EARLY_BEAR");
    expect(result?.isConfirmed).toBe(true);
    expect(db.update).toHaveBeenCalled();
  });

  it("혼합 confidence(high+medium) 5일 → 확정 안 됨 (medium 기준 7일 필요)", async () => {
    // 5일 중 1일이 medium이면 전체가 medium 기준 적용
    const days = [
      makeRow({ regimeDate: "2026-03-14", regime: "EARLY_BEAR", confidence: "high", isConfirmed: false, confirmedAt: null }),
      makeRow({ regimeDate: "2026-03-13", regime: "EARLY_BEAR", confidence: "high", isConfirmed: false, confirmedAt: null }),
      makeRow({ regimeDate: "2026-03-12", regime: "EARLY_BEAR", confidence: "medium", isConfirmed: false, confirmedAt: null }),
      makeRow({ regimeDate: "2026-03-11", regime: "EARLY_BEAR", confidence: "high", isConfirmed: false, confirmedAt: null }),
      makeRow({ regimeDate: "2026-03-10", regime: "EARLY_BEAR", confidence: "high", isConfirmed: false, confirmedAt: null }),
    ];

    const prevConfirmed = makeRow({
      regimeDate: "2026-02-20",
      regime: "MID_BULL",
      isConfirmed: true,
      confirmedAt: "2026-02-20",
    });

    const selectCallbacks = [
      [prevConfirmed],
      days,
    ];
    let selectCallCount = 0;

    vi.mocked(db.select).mockImplementation(() => {
      const rows = selectCallbacks[selectCallCount] ?? [];
      selectCallCount++;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return makeSelectChain(rows) as any;
    });

    const result = await applyHysteresis("2026-03-14");

    // 1일이라도 medium → 7일 필요, 5일로는 부족
    expect(result?.regime).toBe("MID_BULL");
    expect(db.update).not.toHaveBeenCalled();
  });

  it("medium confidence 6일 연속 → 확정 안 됨 (7일 필요)", async () => {
    const days = Array.from({ length: 6 }, (_, i) =>
      makeRow({
        regimeDate: `2026-03-${String(10 + i).padStart(2, "0")}`,
        regime: "EARLY_BEAR",
        confidence: "medium",
        isConfirmed: false,
        confirmedAt: null,
      }),
    ).reverse();

    const prevConfirmed = makeRow({
      regimeDate: "2026-02-20",
      regime: "MID_BULL",
      isConfirmed: true,
      confirmedAt: "2026-02-20",
    });

    const selectCallbacks = [
      [prevConfirmed],
      days,
    ];
    let selectCallCount = 0;

    vi.mocked(db.select).mockImplementation(() => {
      const rows = selectCallbacks[selectCallCount] ?? [];
      selectCallCount++;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return makeSelectChain(rows) as any;
    });

    const result = await applyHysteresis("2026-03-15");

    // 6일 < 7일 → 아직 부족
    expect(result?.regime).toBe("MID_BULL");
    expect(db.update).not.toHaveBeenCalled();
  });

  it("이슈 #520 시나리오: 2.5일 주기 medium 진동 → 확정 안 됨", async () => {
    // 실제 이슈 데이터: EARLY_BULL↔EARLY_BEAR 진동, 전부 medium
    // 3/23 EARLY_BULL, 3/26 EARLY_BEAR — 최근 pending이 섞여 있으므로 확정 불가
    const pendingRows = [
      makeRow({ regimeDate: "2026-03-26", regime: "EARLY_BEAR", confidence: "medium", isConfirmed: false, confirmedAt: null }),
      makeRow({ regimeDate: "2026-03-25", regime: "EARLY_BEAR", confidence: "medium", isConfirmed: false, confirmedAt: null }),
      makeRow({ regimeDate: "2026-03-24", regime: "EARLY_BEAR", confidence: "medium", isConfirmed: false, confirmedAt: null }),
      makeRow({ regimeDate: "2026-03-23", regime: "EARLY_BULL", confidence: "medium", isConfirmed: false, confirmedAt: null }),
      makeRow({ regimeDate: "2026-03-20", regime: "EARLY_BEAR", confidence: "medium", isConfirmed: false, confirmedAt: null }),
      makeRow({ regimeDate: "2026-03-19", regime: "EARLY_BEAR", confidence: "medium", isConfirmed: false, confirmedAt: null }),
      makeRow({ regimeDate: "2026-03-18", regime: "EARLY_BULL", confidence: "medium", isConfirmed: false, confirmedAt: null }),
    ];

    const prevConfirmed = makeRow({
      regimeDate: "2026-03-12",
      regime: "LATE_BULL",
      confidence: "high",
      isConfirmed: true,
      confirmedAt: "2026-03-12",
    });

    const selectCallbacks = [
      [prevConfirmed],
      pendingRows,
    ];
    let selectCallCount = 0;

    vi.mocked(db.select).mockImplementation(() => {
      const rows = selectCallbacks[selectCallCount] ?? [];
      selectCallCount++;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return makeSelectChain(rows) as any;
    });

    const result = await applyHysteresis("2026-03-26");

    // 레짐이 섞여 있으므로 allSameRegime = false → 확정 불가
    // confirmed LATE_BULL 유지
    expect(result?.regime).toBe("LATE_BULL");
    expect(db.update).not.toHaveBeenCalled();
  });
});

// ─── loadConfirmedRegime ──────────────────────────────────────────────────────

describe("loadConfirmedRegime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("is_confirmed = true인 최신 레코드를 반환한다", async () => {
    const confirmedRow = makeRow({ isConfirmed: true, confirmedAt: "2026-03-14" });
    vi.mocked(db.select).mockReturnValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      makeSelectChain([confirmedRow]) as any,
    );

    const result = await loadConfirmedRegime();

    expect(result).not.toBeNull();
    expect(result?.isConfirmed).toBe(true);
    expect(result?.regime).toBe("MID_BULL");
  });

  it("confirmed 레코드가 없으면 null을 반환한다", async () => {
    vi.mocked(db.select).mockReturnValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      makeSelectChain([]) as any,
    );

    const result = await loadConfirmedRegime();
    expect(result).toBeNull();
  });
});

// ─── loadPendingRegimes ───────────────────────────────────────────────────────

describe("loadPendingRegimes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("is_confirmed = false인 최신 레코드를 반환한다", async () => {
    const pendingRows = [
      makeRow({ regimeDate: "2026-03-14", isConfirmed: false, confirmedAt: null }),
      makeRow({ regimeDate: "2026-03-13", isConfirmed: false, confirmedAt: null }),
    ];
    const chain = makeSelectChain(pendingRows);
    vi.mocked(db.select).mockReturnValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      chain as any,
    );

    const result = await loadPendingRegimes();

    expect(chain.where).toHaveBeenCalled();
    expect(result).toHaveLength(2);
  });

  it("limit 파라미터가 전달된다", async () => {
    const chain = makeSelectChain([]);
    vi.mocked(db.select).mockReturnValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      chain as any,
    );

    await loadPendingRegimes(3);

    expect(chain.limit).toHaveBeenCalledWith(3);
  });
});

// ─── loadRecentRegimes ────────────────────────────────────────────────────────

describe("loadRecentRegimes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("confirmed 레코드만 반환한다 (pending 제외)", async () => {
    const confirmedRows = [
      makeRow({ regimeDate: "2026-03-14", isConfirmed: true }),
      makeRow({ regimeDate: "2026-03-13", isConfirmed: true }),
    ];
    const chain = makeSelectChain(confirmedRows);
    vi.mocked(db.select).mockReturnValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      chain as any,
    );

    const result = await loadRecentRegimes(10);

    // where가 호출되어 is_confirmed 필터가 적용되어야 함
    expect(chain.where).toHaveBeenCalled();
    expect(result).toHaveLength(2);
    expect(result.every((r) => r.isConfirmed)).toBe(true);
  });

  it("days 파라미터가 limit에 전달된다", async () => {
    const chain = makeSelectChain([]);
    vi.mocked(db.select).mockReturnValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      chain as any,
    );

    await loadRecentRegimes(5);

    expect(chain.limit).toHaveBeenCalledWith(5);
  });
});
