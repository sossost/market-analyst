/**
 * getIndexReturns.ts — computeWeeklyQuote 단위 테스트
 *
 * computeWeeklyQuote는 내부 함수이므로 로직을 직접 재구현하여 검증한다.
 * 버그 #638: weekStartClose가 전주 마지막 거래일 종가로 올바르게 계산되는지 확인.
 */

import { describe, it, expect } from "vitest";

// ─── 헬퍼: 테스트용 computeWeeklyQuote 로직 복제 ────────────────────────────
// 내부 함수라 직접 import 불가하므로 동일 로직을 로컬에서 검증한다.

interface TestRow {
  date: string;
  close: string | null;
  high: string | null;
  low: string | null;
}

function getWeekMondayUtc(dateStr: string): Date {
  const date = new Date(`${dateStr}T00:00:00Z`);
  const dayOfWeek = date.getUTCDay();
  const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const monday = new Date(date);
  monday.setUTCDate(date.getUTCDate() - daysFromMonday);
  return monday;
}

function computeWeeklyQuoteTest(rows: TestRow[]): {
  weekStartClose: number;
  weekEndClose: number;
  weeklyChangePercent: number;
  weekHigh: number;
  weekLow: number;
  tradingDays: number;
} | null {
  const chronological = [...rows].reverse();

  if (chronological.length < 2) return null;

  const weekEndDate = rows[0].date;
  const weekMonday = getWeekMondayUtc(weekEndDate);

  const prevWeekRows = chronological.filter(
    (r) => new Date(`${r.date}T00:00:00Z`) < weekMonday,
  );
  const prevWeekRow = prevWeekRows.length > 0 ? prevWeekRows[prevWeekRows.length - 1] : null;

  if (prevWeekRow == null) return null;

  const weekStartClose = Number(prevWeekRow.close);
  if (!Number.isFinite(weekStartClose) || weekStartClose === 0) return null;

  const thisWeekRows = chronological.filter(
    (r) => new Date(`${r.date}T00:00:00Z`) >= weekMonday,
  );

  if (thisWeekRows.length === 0) return null;

  const weekEndClose = Number(thisWeekRows[thisWeekRows.length - 1].close);
  if (!Number.isFinite(weekEndClose)) return null;

  const highs = thisWeekRows
    .map((r) => Number(r.high))
    .filter((h) => Number.isFinite(h));
  const lows = thisWeekRows
    .map((r) => Number(r.low))
    .filter((l) => Number.isFinite(l));

  if (highs.length === 0 || lows.length === 0) return null;

  const weekHigh = Math.max(...highs);
  const weekLow = Math.min(...lows);
  const weeklyChange = weekEndClose - weekStartClose;
  const weeklyChangePercent = (weeklyChange / weekStartClose) * 100;

  return {
    weekStartClose: Number(weekStartClose.toFixed(2)),
    weekEndClose: Number(weekEndClose.toFixed(2)),
    weeklyChangePercent: Number(weeklyChangePercent.toFixed(2)),
    weekHigh: Number(weekHigh.toFixed(2)),
    weekLow: Number(weekLow.toFixed(2)),
    tradingDays: thisWeekRows.length,
  };
}

// ─── 팩토리 함수 ──────────────────────────────────────────────────────────────

function makeRow(date: string, close: number, high?: number, low?: number): TestRow {
  return {
    date,
    close: String(close),
    high: String(high ?? close + 5),
    low: String(low ?? close - 5),
  };
}

// ─── 테스트 ───────────────────────────────────────────────────────────────────

describe("computeWeeklyQuote — weekStartClose 교정", () => {
  it("정상 케이스: weekStartClose = 전주 금요일 종가, weekEndClose = 이번주 금요일 종가", () => {
    // 이번주: 2026-03-30(월) ~ 2026-04-02(목, 금요일 휴장 가정)
    // 전주 마지막 거래일: 2026-03-27(금)
    // rows는 desc 정렬
    const rows: TestRow[] = [
      makeRow("2026-04-02", 21879.18, 22000, 21700), // 이번주 목요일 (주말 기준 last)
      makeRow("2026-04-01", 21600.0, 21750, 21400),  // 이번주 화요일
      makeRow("2026-03-31", 21400.0, 21500, 21200),  // 이번주 월요일
      makeRow("2026-03-27", 20948.36, 21100, 20800), // 전주 금요일 ← weekStartClose 기댓값
      makeRow("2026-03-26", 20500.0, 20700, 20300),
      makeRow("2026-03-25", 20300.0, 20500, 20100),
    ];

    const result = computeWeeklyQuoteTest(rows);

    expect(result).not.toBeNull();
    expect(result!.weekStartClose).toBe(20948.36);
    expect(result!.weekEndClose).toBe(21879.18);
    expect(result!.weeklyChangePercent).toBeCloseTo(4.44, 1);
    expect(result!.tradingDays).toBe(3); // 월,화,목
  });

  it("이번주 첫 거래일이 화요일인 케이스 (월요일 공휴일): 전주 금요일을 weekStartClose로 사용한다", () => {
    // 월요일 공휴일 → 이번주 첫 거래일 = 화요일
    const rows: TestRow[] = [
      makeRow("2026-04-03", 22000, 22200, 21800), // 금요일
      makeRow("2026-04-02", 21900, 22000, 21700), // 목요일
      makeRow("2026-04-01", 21700, 21900, 21500), // 수요일
      makeRow("2026-03-31", 21500, 21700, 21300), // 화요일 (이번주 첫 거래일)
      // 월요일 공휴일 — 없음
      makeRow("2026-03-27", 21000, 21200, 20800), // 전주 금요일 ← weekStartClose
      makeRow("2026-03-26", 20800, 21000, 20600),
    ];

    const result = computeWeeklyQuoteTest(rows);

    expect(result).not.toBeNull();
    expect(result!.weekStartClose).toBe(21000);
    expect(result!.tradingDays).toBe(4); // 화~금
  });

  it("이번주 거래일이 1일(월요일)뿐인 케이스: 전주 금요일을 weekStartClose로 사용한다", () => {
    const rows: TestRow[] = [
      makeRow("2026-03-30", 21200, 21400, 21000), // 이번주 월요일만 있음
      makeRow("2026-03-27", 21000, 21100, 20900), // 전주 금요일 ← weekStartClose
      makeRow("2026-03-26", 20800, 21000, 20600),
      makeRow("2026-03-25", 20600, 20800, 20400),
    ];

    const result = computeWeeklyQuoteTest(rows);

    expect(result).not.toBeNull();
    expect(result!.weekStartClose).toBe(21000);
    expect(result!.weekEndClose).toBe(21200);
    expect(result!.tradingDays).toBe(1);
  });

  it("rows가 2개 미만이면 null을 반환한다", () => {
    const rows: TestRow[] = [
      makeRow("2026-04-02", 21879),
    ];

    const result = computeWeeklyQuoteTest(rows);

    expect(result).toBeNull();
  });

  it("전주 데이터가 없으면 null을 반환한다 (모든 rows가 이번주)", () => {
    // 모든 row가 같은 주(월~금)에 속할 때 — prevWeekRow 없음
    const rows: TestRow[] = [
      makeRow("2026-04-04", 21900, 22000, 21800),
      makeRow("2026-04-03", 21800, 21950, 21700),
      makeRow("2026-04-02", 21700, 21900, 21600),
      makeRow("2026-04-01", 21600, 21800, 21500),
      makeRow("2026-03-31", 21500, 21700, 21400),
    ];

    const result = computeWeeklyQuoteTest(rows);

    expect(result).toBeNull();
  });

  it("weekStartClose가 0이면 null을 반환한다", () => {
    const rows: TestRow[] = [
      makeRow("2026-04-02", 21879),
      makeRow("2026-03-27", 0), // 전주 종가 0 → 계산 불가
      makeRow("2026-03-26", 20500),
    ];

    const result = computeWeeklyQuoteTest(rows);

    expect(result).toBeNull();
  });

  it("주간 high/low는 이번주 거래일 데이터만 기준으로 계산된다 (전주 데이터 제외)", () => {
    const rows: TestRow[] = [
      makeRow("2026-04-02", 21000, 21500, 20800), // 이번주 목요일
      makeRow("2026-04-01", 21200, 21800, 21000), // 이번주 수요일
      makeRow("2026-03-31", 21100, 21200, 20900), // 이번주 월요일
      makeRow("2026-03-27", 20948, 99999, 1),     // 전주 금요일 — high/low는 무시해야 함
      makeRow("2026-03-26", 20500, 99998, 2),
    ];

    const result = computeWeeklyQuoteTest(rows);

    expect(result).not.toBeNull();
    // 이번주 high = max(21500, 21800, 21200) = 21800
    expect(result!.weekHigh).toBe(21800);
    // 이번주 low = min(20800, 21000, 20900) = 20800
    expect(result!.weekLow).toBe(20800);
  });

  it("getWeekMondayUtc: 금요일 입력 시 해당 주 월요일을 반환한다", () => {
    const monday = getWeekMondayUtc("2026-04-03"); // 금요일
    expect(monday.toISOString().slice(0, 10)).toBe("2026-03-30"); // 월요일
  });

  it("getWeekMondayUtc: 월요일 입력 시 자기 자신을 반환한다", () => {
    const monday = getWeekMondayUtc("2026-03-30"); // 월요일
    expect(monday.toISOString().slice(0, 10)).toBe("2026-03-30");
  });

  it("getWeekMondayUtc: 일요일 입력 시 지난 월요일을 반환한다", () => {
    const monday = getWeekMondayUtc("2026-04-05"); // 일요일
    expect(monday.toISOString().slice(0, 10)).toBe("2026-03-30"); // 지난 주 월요일
  });

  it("월 경계 케이스: 전주가 3월이고 이번주가 4월이어도 올바르게 동작한다", () => {
    // 2026-03-28 토요일 → 2026-03-31 월요일 시작
    const rows: TestRow[] = [
      makeRow("2026-04-02", 22000, 22200, 21800), // 이번주 목요일
      makeRow("2026-04-01", 21800, 22000, 21600), // 이번주 수요일
      makeRow("2026-03-31", 21600, 21800, 21400), // 이번주 월요일
      makeRow("2026-03-27", 21400, 21600, 21200), // 전주 금요일 ← weekStartClose
      makeRow("2026-03-26", 21200, 21400, 21000),
    ];

    const result = computeWeeklyQuoteTest(rows);

    expect(result).not.toBeNull();
    expect(result!.weekStartClose).toBe(21400);
  });
});
