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
vi.mock("../../../db/client.js", () => ({
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
vi.mock("../../../db/schema/analyst.js", () => ({
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
vi.mock("../../logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// ─── 모킹 후 대상 모듈 import ─────────────────────────────────────────────────
import { db } from "../../../db/client.js";
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
      [pendingRow],    // 2nd: pending 윈도우 → 1건만 (CONFIRMATION_DAYS=2 미충족)
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

  it("2일 연속 동일 레짐 → 확정된다", async () => {
    const day1 = makeRow({ regimeDate: "2026-03-13", regime: "EARLY_BEAR", isConfirmed: false, confirmedAt: null });
    const day2 = makeRow({ regimeDate: "2026-03-14", regime: "EARLY_BEAR", isConfirmed: false, confirmedAt: null });
    const prevConfirmed = makeRow({ regimeDate: "2026-03-12", regime: "MID_BULL", isConfirmed: true, confirmedAt: "2026-03-12" });

    const selectCallbacks = [
      [prevConfirmed], // 1st: loadConfirmedRegime
      [day2, day1],    // 2nd: pending 윈도우 — 최신순, 2건
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

  it("레짐 A 확정 후 레짐 B가 2일 연속 → B로 전환 확정", async () => {
    // 레짐 A(MID_BULL)가 확정된 상태에서 B(EARLY_BEAR)가 2일 연속 pending
    const earlyBearDay1 = makeRow({ regimeDate: "2026-03-13", regime: "EARLY_BEAR", isConfirmed: false, confirmedAt: null });
    const earlyBearDay2 = makeRow({ regimeDate: "2026-03-14", regime: "EARLY_BEAR", isConfirmed: false, confirmedAt: null });
    const midBullConfirmed = makeRow({ regimeDate: "2026-03-12", regime: "MID_BULL", isConfirmed: true, confirmedAt: "2026-03-12" });

    const selectCallbacks = [
      [midBullConfirmed],              // 1st: loadConfirmedRegime → MID_BULL confirmed
      [earlyBearDay2, earlyBearDay1],  // 2nd: pending 2건 — EARLY_BEAR 연속
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

  it("금요일 pending + 월요일 pending → 주말(3일 차이)을 인접 거래일로 인식하여 확정", async () => {
    // 2026-03-13(금) pending → 2026-03-16(월) pending: 달력 3일 차이
    // MAX_GAP_DAYS = 4이므로 연속 거래일로 판정 → 2일 연속 EARLY_BEAR → 확정
    const fridayPending = makeRow({ regimeDate: "2026-03-13", regime: "EARLY_BEAR", isConfirmed: false, confirmedAt: null });
    const mondayPending = makeRow({ regimeDate: "2026-03-16", regime: "EARLY_BEAR", isConfirmed: false, confirmedAt: null });
    const prevConfirmed = makeRow({ regimeDate: "2026-03-12", regime: "MID_BULL", isConfirmed: true, confirmedAt: "2026-03-12" });

    const selectCallbacks = [
      [prevConfirmed],                    // 1st: loadConfirmedRegime
      [mondayPending, fridayPending],     // 2nd: pending 윈도우 — 금→월, 3일 차이
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

    // 주말을 사이에 두고도 연속 거래일로 인식 → 확정
    expect(result?.regime).toBe("EARLY_BEAR");
    expect(result?.isConfirmed).toBe(true);
    expect(db.update).toHaveBeenCalled();
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
