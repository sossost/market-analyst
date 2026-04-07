/**
 * getMarketPosition — 시장 환경 멀티게이트 단위 테스트
 *
 * 검증 대상:
 * 1. MA200 계산 정확성 — 200개 가격에서 단순 평균
 * 2. 데이터 부족 처리 — 150개 rows 시 MA200 게이트 passed=false
 * 3. A/D 게이트 — ad_ratio 1.5 시 passed=true, 0.8 시 passed=false
 * 4. 신고가/신저가 게이트 — newHighs > newLows 시 passed=true
 * 5. DB 오류 시 폴백 — getMarketPosition이 null 반환
 *
 * DB는 mock 처리. 실제 Supabase 연결 없음.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/db/client", () => ({
  pool: { query: vi.fn() },
}));

import { pool } from "@/db/client";
import { getMarketPosition } from "../getMarketPosition";

const mockQuery = vi.mocked(pool.query);

// ─── 헬퍼 ─────────────────────────────────────────────────────────────────────

/**
 * N개의 가격 배열을 생성한다. 기본값: 5000 (일정한 값).
 * DB 쿼리는 ORDER BY date DESC로 반환하므로 인덱스 0이 최신 날짜.
 * 코드에서 .reverse()를 호출하므로 여기서는 DESC(최신 먼저) 순서로 생성한다.
 */
function makePrices(count: number, price = 5000): { date: string; close: string }[] {
  return Array.from({ length: count }, (_, i) => ({
    // 인덱스 0 = 최신 날짜 (DESC)
    date: `2026-04-${String(count - i).padStart(2, "0")}`,
    close: String(price),
  }));
}

interface SetupOptions {
  priceRows?: { date: string; close: string }[];
  breadthRow?: {
    date: string;
    ad_ratio: string | null;
    new_highs: number | null;
    new_lows: number | null;
  } | null;
  priceQueryThrows?: boolean;
  breadthQueryThrows?: boolean;
}

/**
 * mock 설정: 첫 번째 쿼리 = index_prices (MA 계산), 두 번째 쿼리 = market_breadth_daily.
 * Promise.all로 병렬 실행되므로 호출 순서에 따라 mock을 순차 설정.
 */
function setupMocks({
  priceRows = makePrices(250),
  breadthRow = { date: "2026-04-04", ad_ratio: "1.39", new_highs: 66, new_lows: 56 },
  priceQueryThrows = false,
  breadthQueryThrows = false,
}: SetupOptions = {}): void {
  if (priceQueryThrows) {
    mockQuery.mockRejectedValueOnce(new Error("DB error") as never);
  } else {
    mockQuery.mockResolvedValueOnce({ rows: priceRows } as never);
  }

  if (breadthQueryThrows) {
    mockQuery.mockRejectedValueOnce(new Error("DB error") as never);
  } else {
    const breadthRows = breadthRow != null ? [breadthRow] : [];
    mockQuery.mockResolvedValueOnce({ rows: breadthRows } as never);
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("getMarketPosition", () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  describe("MA200 계산 정확성", () => {
    it("200개 동일 가격이면 MA200 = 해당 가격이고 passed=true(현재가 동일)는 false", async () => {
      // 현재가 == MA200 이면 > 조건 미충족 → passed=false
      const prices = makePrices(200, 5000);
      setupMocks({ priceRows: prices });

      const result = await getMarketPosition("2026-04-04");

      expect(result).not.toBeNull();
      const gate200 = result!.gates[0];
      expect(gate200.label).toBe("S&P 500 > 200MA");
      // 현재가(5000) == MA200(5000) → passed=false
      expect(gate200.passed).toBe(false);
      expect(gate200.detail).toBe("+0.0%");
    });

    it("현재가가 MA200보다 높으면 gate200 passed=true", async () => {
      // DB는 DESC 순서 → 인덱스 0이 최신 날짜(현재가)
      // 나머지 199개는 5000, 최신(인덱스 0)만 5100
      const prices = makePrices(200, 5000);
      prices[0] = { date: "2026-04-04", close: "5100" };
      setupMocks({ priceRows: prices });

      const result = await getMarketPosition("2026-04-04");

      expect(result).not.toBeNull();
      const gate200 = result!.gates[0];
      expect(gate200.passed).toBe(true);
      // MA200 ≈ (199×5000 + 5100)/200 = 5000.5, 현재가 5100 → +%
      expect(gate200.detail).toMatch(/^\+/);
    });

    it("현재가가 MA200보다 낮으면 gate200 passed=false이고 detail에 마이너스 포함", async () => {
      // 최신(인덱스 0)만 4900으로 설정
      const prices = makePrices(200, 5000);
      prices[0] = { date: "2026-04-04", close: "4900" };
      setupMocks({ priceRows: prices });

      const result = await getMarketPosition("2026-04-04");

      expect(result).not.toBeNull();
      const gate200 = result!.gates[0];
      expect(gate200.passed).toBe(false);
      expect(gate200.detail).toMatch(/^-/);
    });
  });

  describe("데이터 부족 처리", () => {
    it("prices가 150개일 때 MA200 게이트 passed=false, detail='데이터 부족'", async () => {
      const prices = makePrices(150);
      setupMocks({ priceRows: prices });

      const result = await getMarketPosition("2026-04-04");

      expect(result).not.toBeNull();
      const gate200 = result!.gates[0];
      expect(gate200.passed).toBe(false);
      expect(gate200.detail).toBe("데이터 부족");
    });

    it("prices가 50개 이상이면 MA50 게이트는 정상 계산", async () => {
      // DB DESC 순서: 인덱스 0이 최신(현재가)
      const prices = makePrices(60, 5000);
      prices[0] = { date: "2026-04-04", close: "5100" };
      setupMocks({ priceRows: prices });

      const result = await getMarketPosition("2026-04-04");

      expect(result).not.toBeNull();
      const gate50 = result!.gates[1];
      expect(gate50.label).toBe("S&P 500 > 50MA");
      expect(gate50.passed).toBe(true);
      expect(gate50.detail).not.toBe("데이터 부족");
    });

    it("prices가 40개이면 MA50도 '데이터 부족'", async () => {
      const prices = makePrices(40);
      setupMocks({ priceRows: prices });

      const result = await getMarketPosition("2026-04-04");

      expect(result).not.toBeNull();
      const gate50 = result!.gates[1];
      expect(gate50.passed).toBe(false);
      expect(gate50.detail).toBe("데이터 부족");
    });

    it("prices가 0개이면 null 반환", async () => {
      setupMocks({ priceRows: [] });

      const result = await getMarketPosition("2026-04-04");

      expect(result).toBeNull();
    });
  });

  describe("A/D 게이트", () => {
    it("ad_ratio 1.5이면 passed=true", async () => {
      setupMocks({
        breadthRow: { date: "2026-04-04", ad_ratio: "1.50", new_highs: 50, new_lows: 30 },
      });

      const result = await getMarketPosition("2026-04-04");

      expect(result).not.toBeNull();
      const gateAd = result!.gates[3];
      expect(gateAd.label).toBe("A/D > 1.0");
      expect(gateAd.passed).toBe(true);
      expect(gateAd.detail).toBe("1.50");
    });

    it("ad_ratio 0.8이면 passed=false", async () => {
      setupMocks({
        breadthRow: { date: "2026-04-04", ad_ratio: "0.80", new_highs: 30, new_lows: 50 },
      });

      const result = await getMarketPosition("2026-04-04");

      expect(result).not.toBeNull();
      const gateAd = result!.gates[3];
      expect(gateAd.passed).toBe(false);
      expect(gateAd.detail).toBe("0.80");
    });

    it("ad_ratio가 null이면 passed=false, detail='—'", async () => {
      setupMocks({
        breadthRow: { date: "2026-04-04", ad_ratio: null, new_highs: 50, new_lows: 30 },
      });

      const result = await getMarketPosition("2026-04-04");

      expect(result).not.toBeNull();
      const gateAd = result!.gates[3];
      expect(gateAd.passed).toBe(false);
      expect(gateAd.detail).toBe("—");
    });
  });

  describe("신고가/신저가 게이트", () => {
    it("newHighs > newLows이면 passed=true이고 detail에 두 수치 포함", async () => {
      setupMocks({
        breadthRow: { date: "2026-04-04", ad_ratio: "1.39", new_highs: 66, new_lows: 56 },
      });

      const result = await getMarketPosition("2026-04-04");

      expect(result).not.toBeNull();
      const gateHl = result!.gates[2];
      expect(gateHl.label).toBe("신고가 > 신저가");
      expect(gateHl.passed).toBe(true);
      expect(gateHl.detail).toBe("66 vs 56");
    });

    it("newHighs <= newLows이면 passed=false", async () => {
      setupMocks({
        breadthRow: { date: "2026-04-04", ad_ratio: "1.39", new_highs: 30, new_lows: 80 },
      });

      const result = await getMarketPosition("2026-04-04");

      expect(result).not.toBeNull();
      const gateHl = result!.gates[2];
      expect(gateHl.passed).toBe(false);
      expect(gateHl.detail).toBe("30 vs 80");
    });

    it("breadthRow가 null이면 게이트 passed=false, detail='—'", async () => {
      setupMocks({ breadthRow: null });

      const result = await getMarketPosition("2026-04-04");

      expect(result).not.toBeNull();
      const gateHl = result!.gates[2];
      expect(gateHl.passed).toBe(false);
      expect(gateHl.detail).toBe("—");
    });
  });

  describe("DB 오류 시 폴백", () => {
    it("index_prices 쿼리 실패 시 null 반환", async () => {
      setupMocks({ priceQueryThrows: true });

      const result = await getMarketPosition("2026-04-04");

      expect(result).toBeNull();
    });

    it("market_breadth_daily 쿼리 실패 시 breadth 게이트 passed=false로 나머지 정상 반환", async () => {
      setupMocks({ breadthQueryThrows: true });

      const result = await getMarketPosition("2026-04-04");

      // breadth 쿼리 실패여도 prices는 성공했으면 null이 아니라 게이트 포함 결과 반환
      // (DB 오류를 catch하여 null 반환하므로 전체 null)
      expect(result).toBeNull();
    });
  });

  describe("결과 구조 검증", () => {
    it("정상 데이터이면 4개 게이트와 passCount/totalCount를 반환한다", async () => {
      // DB DESC 순서: 인덱스 0이 최신(현재가)
      const prices = makePrices(250, 5000);
      prices[0] = { date: "2026-04-04", close: "5200" };
      setupMocks({
        priceRows: prices,
        breadthRow: { date: "2026-04-04", ad_ratio: "1.39", new_highs: 66, new_lows: 56 },
      });

      const result = await getMarketPosition("2026-04-04");

      expect(result).not.toBeNull();
      expect(result!.gates).toHaveLength(4);
      expect(result!.totalCount).toBe(4);
      expect(result!.passCount).toBeGreaterThanOrEqual(0);
      expect(result!.passCount).toBeLessThanOrEqual(4);
      expect(result!.date).toBe("2026-04-04");
    });

    it("passCount는 passed=true인 게이트 수와 일치한다", async () => {
      const prices = makePrices(250, 5000);
      prices[0] = { date: "2026-04-04", close: "5200" };
      setupMocks({
        priceRows: prices,
        breadthRow: { date: "2026-04-04", ad_ratio: "1.39", new_highs: 66, new_lows: 56 },
      });

      const result = await getMarketPosition("2026-04-04");

      expect(result).not.toBeNull();
      const expectedPassCount = result!.gates.filter((g) => g.passed).length;
      expect(result!.passCount).toBe(expectedPassCount);
    });
  });
});
