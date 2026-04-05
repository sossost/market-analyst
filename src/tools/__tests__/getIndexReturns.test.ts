/**
 * getIndexReturns.ts — computeWeeklyQuote / getWeekMondayUtc 단위 테스트
 *
 * 버그 #638: weekStartClose가 전주 마지막 거래일 종가로 올바르게 계산되는지 확인.
 */

import { describe, it, expect } from "vitest";
import { computeWeeklyQuote, getWeekMondayUtc } from "../getIndexReturns";

// ─── 팩토리 함수 ──────────────────────────────────────────────────────────────

interface RowOverrides {
  high?: number;
  low?: number;
  volume?: number;
}

function makeRow(
  date: string,
  close: number,
  overrides: RowOverrides = {},
): {
  date: string;
  close: string | null;
  high: string | null;
  low: string | null;
  open: string | null;
  volume: string | null;
} {
  const high = overrides.high ?? close + 5;
  const low = overrides.low ?? close - 5;
  return {
    date,
    close: String(close),
    high: String(high),
    low: String(low),
    open: String(close),
    volume: String(overrides.volume ?? 1_000_000),
  };
}

const SYMBOL = "^GSPC";

// ─── 테스트 ───────────────────────────────────────────────────────────────────

describe("computeWeeklyQuote — weekStartClose 교정", () => {
  it("정상 케이스: weekStartClose = 전주 금요일 종가, weekEndClose = 이번주 마지막 거래일 종가", () => {
    // 이번주: 2026-03-30(월) ~ 2026-04-02(목, 금요일 휴장 가정)
    // 전주 마지막 거래일: 2026-03-27(금)
    // rows는 desc 정렬
    const rows = [
      makeRow("2026-04-02", 21879.18, { high: 22000, low: 21700 }),
      makeRow("2026-04-01", 21600.0, { high: 21750, low: 21400 }),
      makeRow("2026-03-31", 21400.0, { high: 21500, low: 21200 }),
      makeRow("2026-03-27", 20948.36, { high: 21100, low: 20800 }), // 전주 금요일
      makeRow("2026-03-26", 20500.0, { high: 20700, low: 20300 }),
      makeRow("2026-03-25", 20300.0, { high: 20500, low: 20100 }),
    ];

    const result = computeWeeklyQuote(SYMBOL, rows);

    expect(result).not.toBeNull();
    expect(result!.weekStartClose).toBe(20948.36);
    expect(result!.weekEndClose).toBe(21879.18);
    expect(result!.weeklyChangePercent).toBeCloseTo(4.44, 1);
    expect(result!.tradingDays).toBe(3); // 월, 화, 목
  });

  it("이번주 첫 거래일이 화요일인 케이스 (월요일 공휴일): 전주 금요일을 weekStartClose로 사용한다", () => {
    const rows = [
      makeRow("2026-04-03", 22000, { high: 22200, low: 21800 }), // 금요일
      makeRow("2026-04-02", 21900, { high: 22000, low: 21700 }), // 목요일
      makeRow("2026-04-01", 21700, { high: 21900, low: 21500 }), // 수요일
      makeRow("2026-03-31", 21500, { high: 21700, low: 21300 }), // 화요일 (이번주 첫 거래일)
      // 월요일 공휴일 — 없음
      makeRow("2026-03-27", 21000, { high: 21200, low: 20800 }), // 전주 금요일
      makeRow("2026-03-26", 20800, { high: 21000, low: 20600 }),
    ];

    const result = computeWeeklyQuote(SYMBOL, rows);

    expect(result).not.toBeNull();
    expect(result!.weekStartClose).toBe(21000);
    expect(result!.tradingDays).toBe(4); // 화 ~ 금
  });

  it("이번주 거래일이 1일(월요일)뿐인 케이스: 전주 금요일을 weekStartClose로 사용한다", () => {
    const rows = [
      makeRow("2026-03-30", 21200, { high: 21400, low: 21000 }), // 이번주 월요일만 있음
      makeRow("2026-03-27", 21000, { high: 21100, low: 20900 }), // 전주 금요일
      makeRow("2026-03-26", 20800, { high: 21000, low: 20600 }),
      makeRow("2026-03-25", 20600, { high: 20800, low: 20400 }),
    ];

    const result = computeWeeklyQuote(SYMBOL, rows);

    expect(result).not.toBeNull();
    expect(result!.weekStartClose).toBe(21000);
    expect(result!.weekEndClose).toBe(21200);
    expect(result!.tradingDays).toBe(1);
  });

  it("rows가 2개 미만이면 null을 반환한다", () => {
    const rows = [makeRow("2026-04-02", 21879)];

    const result = computeWeeklyQuote(SYMBOL, rows);

    expect(result).toBeNull();
  });

  it("전주 데이터가 없으면 null을 반환한다 (모든 rows가 이번주)", () => {
    const rows = [
      makeRow("2026-04-04", 21900, { high: 22000, low: 21800 }),
      makeRow("2026-04-03", 21800, { high: 21950, low: 21700 }),
      makeRow("2026-04-02", 21700, { high: 21900, low: 21600 }),
      makeRow("2026-04-01", 21600, { high: 21800, low: 21500 }),
      makeRow("2026-03-31", 21500, { high: 21700, low: 21400 }),
    ];

    const result = computeWeeklyQuote(SYMBOL, rows);

    expect(result).toBeNull();
  });

  it("weekStartClose가 0이면 null을 반환한다", () => {
    const rows = [
      makeRow("2026-04-02", 21879),
      makeRow("2026-03-27", 0), // 전주 종가 0 → 계산 불가
      makeRow("2026-03-26", 20500),
    ];

    const result = computeWeeklyQuote(SYMBOL, rows);

    expect(result).toBeNull();
  });

  it("주간 high/low는 이번주 거래일 데이터만 기준으로 계산된다 (전주 데이터 제외)", () => {
    const rows = [
      makeRow("2026-04-02", 21000, { high: 21500, low: 20800 }), // 이번주 목요일
      makeRow("2026-04-01", 21200, { high: 21800, low: 21000 }), // 이번주 수요일
      makeRow("2026-03-31", 21100, { high: 21200, low: 20900 }), // 이번주 월요일
      makeRow("2026-03-27", 20948, { high: 99999, low: 1 }),     // 전주 금요일 — high/low 무시
      makeRow("2026-03-26", 20500, { high: 99998, low: 2 }),
    ];

    const result = computeWeeklyQuote(SYMBOL, rows);

    expect(result).not.toBeNull();
    // 이번주 high = max(21500, 21800, 21200) = 21800
    expect(result!.weekHigh).toBe(21800);
    // 이번주 low = min(20800, 21000, 20900) = 20800
    expect(result!.weekLow).toBe(20800);
  });

  it("주말(토/일) row가 포함되어 있어도 필터링 후 정상 계산된다", () => {
    const rows = [
      makeRow("2026-04-05", 22100, { high: 22200, low: 22000 }), // 일요일 — 제외
      makeRow("2026-04-04", 22050, { high: 22100, low: 21950 }), // 토요일 — 제외
      makeRow("2026-04-03", 22000, { high: 22200, low: 21800 }), // 금요일
      makeRow("2026-04-02", 21900, { high: 22000, low: 21700 }), // 목요일
      makeRow("2026-03-27", 21000, { high: 21200, low: 20800 }), // 전주 금요일
      makeRow("2026-03-26", 20800, { high: 21000, low: 20600 }),
    ];

    const result = computeWeeklyQuote(SYMBOL, rows);

    expect(result).not.toBeNull();
    // 주말 row 제외 후 weekEndDate = 2026-04-03(금요일)
    expect(result!.weekEndClose).toBe(22000);
    expect(result!.weekStartClose).toBe(21000);
    // tradingDays = 금요일 + 목요일 = 2
    expect(result!.tradingDays).toBe(2);
  });

  it("주말 row만 있고 평일 row가 2개 미만이면 null을 반환한다", () => {
    const rows = [
      makeRow("2026-04-05", 22100, { high: 22200, low: 22000 }), // 일요일
      makeRow("2026-04-04", 22050, { high: 22100, low: 21950 }), // 토요일
      makeRow("2026-04-03", 22000, { high: 22200, low: 21800 }), // 금요일 1개뿐
    ];

    const result = computeWeeklyQuote(SYMBOL, rows);

    // 평일 row 1개 → 전주 기준점 없음 → null
    expect(result).toBeNull();
  });

  it("월 경계 케이스: 전주가 3월이고 이번주가 4월이어도 올바르게 동작한다", () => {
    const rows = [
      makeRow("2026-04-02", 22000, { high: 22200, low: 21800 }), // 이번주 목요일
      makeRow("2026-04-01", 21800, { high: 22000, low: 21600 }), // 이번주 수요일
      makeRow("2026-03-31", 21600, { high: 21800, low: 21400 }), // 이번주 월요일
      makeRow("2026-03-27", 21400, { high: 21600, low: 21200 }), // 전주 금요일
      makeRow("2026-03-26", 21200, { high: 21400, low: 21000 }),
    ];

    const result = computeWeeklyQuote(SYMBOL, rows);

    expect(result).not.toBeNull();
    expect(result!.weekStartClose).toBe(21400);
  });
});

describe("getWeekMondayUtc", () => {
  it("금요일 입력 시 해당 주 월요일을 반환한다", () => {
    const monday = getWeekMondayUtc("2026-04-03"); // 금요일
    expect(monday.toISOString().slice(0, 10)).toBe("2026-03-30");
  });

  it("월요일 입력 시 자기 자신을 반환한다", () => {
    const monday = getWeekMondayUtc("2026-03-30"); // 월요일
    expect(monday.toISOString().slice(0, 10)).toBe("2026-03-30");
  });

  it("일요일 입력 시 지난 월요일을 반환한다", () => {
    const monday = getWeekMondayUtc("2026-04-05"); // 일요일
    expect(monday.toISOString().slice(0, 10)).toBe("2026-03-30");
  });
});
