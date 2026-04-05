import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ──────────────────────────────────────────────────────
const { mockSelect, mockFetchJson } = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  mockFetchJson: vi.fn(),
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

vi.mock("@/db/client", () => ({
  db: {
    select: mockSelect,
  },
}));

vi.mock("@/etl/utils/common", () => ({
  fetchJson: mockFetchJson,
  toStrNum: (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) ? String(n) : null;
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

// ─── Helpers ────────────────────────────────────────────────────

/** DB 조회 결과를 만드는 헬퍼 (날짜 내림차순 — DB orderBy desc) */
function makeDbRows(
  closes: number[],
  highs?: number[],
  lows?: number[],
) {
  return closes.map((c, i) => ({
    date: `2026-03-${String(24 - i).padStart(2, "0")}`,
    open: String(c),
    high: String(highs?.[i] ?? c),
    low: String(lows?.[i] ?? c),
    close: String(c),
    volume: "1000000",
  }));
}

/** Drizzle select chain mock: db.select().from().where().orderBy().limit() */
function setupDbMock(rowsBySymbol: Record<string, ReturnType<typeof makeDbRows>>) {
  const limitFn = vi.fn();
  const orderByFn = vi.fn().mockReturnValue({ limit: limitFn });
  const whereFn = vi.fn().mockReturnValue({ orderBy: orderByFn });
  const fromFn = vi.fn().mockReturnValue({ where: whereFn });
  mockSelect.mockReturnValue({ from: fromFn });

  // symbol은 where 절에서 eq(indexPrices.symbol, symbol)로 전달됨
  // 5개 지수 호출에 대해 순서대로 응답
  const symbols = ["^GSPC", "^IXIC", "^DJI", "^RUT", "^VIX"];
  let callIndex = 0;
  limitFn.mockImplementation(() => {
    const sym = symbols[callIndex % symbols.length];
    callIndex++;
    return Promise.resolve(rowsBySymbol[sym] ?? []);
  });

  return { limitFn, whereFn };
}

function makeFearGreedResponse(score = 45, rating = "Fear") {
  return {
    ok: true,
    json: async () => ({
      fear_and_greed: {
        score,
        rating,
        previous_close: 44,
        previous_1_week: 40,
        previous_1_month: 50,
      },
    }),
  };
}

function makeFailedResponse(status = 500) {
  return { ok: false, status, json: async () => ({}) };
}

// ─── Tests ──────────────────────────────────────────────────────

describe("getIndexReturns", () => {
  let getIndexReturns: typeof import("@/tools/getIndexReturns").getIndexReturns;

  beforeEach(async () => {
    vi.resetModules();
    mockFetch.mockReset();
    mockSelect.mockReset();
    mockFetchJson.mockReset();

    process.env.DATA_API = "https://financialmodelingprep.com";
    process.env.FMP_API_KEY = "test-key";

    const mod = await import("@/tools/getIndexReturns");
    getIndexReturns = mod.getIndexReturns;
  });

  describe("daily mode (default)", () => {
    it("DB에서 2일 데이터를 읽어 일간 등락률을 계산한다", async () => {
      // 모든 지수에 대해 동일한 DB 데이터
      const rows = makeDbRows([5050, 5000]); // today=5050, prev=5000
      const allSymbolRows: Record<string, ReturnType<typeof makeDbRows>> = {
        "^GSPC": rows,
        "^IXIC": rows,
        "^DJI": rows,
        "^RUT": rows,
        "^VIX": rows,
      };
      setupDbMock(allSymbolRows);

      mockFetch.mockImplementation(async (url: string) => {
        if (typeof url === "string" && url.includes("cnn.io")) {
          return makeFearGreedResponse();
        }
        return makeFailedResponse();
      });

      const result = JSON.parse(await getIndexReturns.execute({}));

      expect(result.indices).toHaveLength(5);
      expect(result.indices[0]).toHaveProperty("close", 5050);
      expect(result.indices[0]).toHaveProperty("change", 50);
      expect(result.indices[0]).toHaveProperty("changePercent", 1);
      expect(result.indices[0]).not.toHaveProperty("weekStartClose");
      expect(result.fearGreed).not.toBeNull();
    });

    it("mode: 'daily' 명시 시에도 daily 동작", async () => {
      const rows = makeDbRows([5050, 5000]);
      setupDbMock({
        "^GSPC": rows, "^IXIC": rows, "^DJI": rows, "^RUT": rows, "^VIX": rows,
      });

      mockFetch.mockImplementation(async (url: string) => {
        if (typeof url === "string" && url.includes("cnn.io")) {
          return makeFearGreedResponse();
        }
        return makeFailedResponse();
      });

      const result = JSON.parse(
        await getIndexReturns.execute({ mode: "daily" }),
      );

      expect(result.indices).toHaveLength(5);
      expect(result.indices[0]).toHaveProperty("changePercent");
      expect(result.indices[0]).not.toHaveProperty("weeklyChangePercent");
    });

    it("DB 데이터가 부족하면 FMP API fallback을 사용한다", async () => {
      // DB에 데이터 1건만 — 2건 미만이므로 fallback
      const allSymbolRows: Record<string, ReturnType<typeof makeDbRows>> = {
        "^GSPC": makeDbRows([5050]),
        "^IXIC": makeDbRows([5050]),
        "^DJI": makeDbRows([5050]),
        "^RUT": makeDbRows([5050]),
        "^VIX": makeDbRows([5050]),
      };
      setupDbMock(allSymbolRows);

      // FMP fallback 응답
      mockFetchJson.mockResolvedValue({
        historical: [
          { date: "2026-03-24", open: 5050, high: 5060, low: 5040, close: 5050, volume: 1000000 },
          { date: "2026-03-23", open: 5000, high: 5010, low: 4990, close: 5000, volume: 900000 },
        ],
      });

      mockFetch.mockImplementation(async (url: string) => {
        if (typeof url === "string" && url.includes("cnn.io")) {
          return makeFearGreedResponse();
        }
        return makeFailedResponse();
      });

      const result = JSON.parse(await getIndexReturns.execute({}));

      expect(result.indices).toHaveLength(5);
      expect(mockFetchJson).toHaveBeenCalledTimes(5);
      expect(result.indices[0].change).toBe(50);
    });
  });

  describe("weekly mode", () => {
    it("주간 누적 수익률을 올바르게 계산한다", async () => {
      // DB 결과는 날짜 내림차순: 최신 → 과거
      // 이번주(2026-03-30 월 ~ 2026-04-03 금) + 전주 마지막 거래일(2026-03-27 금)
      // weekStartClose = 전주 금요일(2026-03-27) close = 5000
      // weekEndClose = 이번주 금요일(2026-04-03) close = 5250
      const rows = [
        { date: "2026-04-03", open: "5240", high: "5260", low: "5230", close: "5250", volume: "1000000" }, // 금
        { date: "2026-04-02", open: "5190", high: "5220", low: "5180", close: "5200", volume: "1000000" }, // 목
        { date: "2026-04-01", open: "5090", high: "5120", low: "5080", close: "5100", volume: "1000000" }, // 수
        { date: "2026-03-31", open: "5040", high: "5060", low: "5030", close: "5050", volume: "1000000" }, // 화
        { date: "2026-03-30", open: "5010", high: "5020", low: "4990", close: "5010", volume: "1000000" }, // 월 (이번주 첫 거래일)
        { date: "2026-03-27", open: "4990", high: "5010", low: "4990", close: "5000", volume: "1000000" }, // 전주 금 ← weekStartClose
        { date: "2026-03-26", open: "4950", high: "4970", low: "4930", close: "4960", volume: "1000000" }, // 전주 목
      ];

      setupDbMock({
        "^GSPC": rows, "^IXIC": rows, "^DJI": rows, "^RUT": rows, "^VIX": rows,
      });

      mockFetch.mockImplementation(async (url: string) => {
        if (typeof url === "string" && url.includes("cnn.io")) {
          return makeFearGreedResponse();
        }
        return makeFailedResponse();
      });

      const result = JSON.parse(
        await getIndexReturns.execute({ mode: "weekly" }),
      );

      expect(result.mode).toBe("weekly");
      expect(result.indices).toHaveLength(5);

      const index = result.indices[0];
      // weekStartClose = 전주 금요일 2026-03-27 close = 5000
      expect(index.weekStartClose).toBe(5000);
      // weekEndClose = 이번주 금요일 2026-04-03 close = 5250
      expect(index.weekEndClose).toBe(5250);
      // weeklyChange = 5250 - 5000 = 250, weeklyChangePercent = 250/5000*100 = 5
      expect(index.weeklyChange).toBe(250);
      expect(index.weeklyChangePercent).toBe(5);
      // weekHigh/weekLow는 이번주(월~금) 데이터만 기준
      expect(index.weekHigh).toBe(5260);
      expect(index.weekLow).toBe(4990);
      expect(index.tradingDays).toBe(5);
    });

    it("closePosition이 near_high로 정확히 계산된다", async () => {
      // 이번주(2026-03-30 월, 2026-03-31 화) + 전주(2026-03-27 금)
      // 이번주 weekHigh=110, weekLow=100, weekEndClose=108
      // (108-100)/(110-100)=0.8 → near_high
      const rows = [
        { date: "2026-03-31", open: "106", high: "109", low: "106", close: "108", volume: "1000" }, // 화
        { date: "2026-03-30", open: "100", high: "110", low: "100", close: "105", volume: "1000" }, // 월
        { date: "2026-03-27", open: "98",  high: "99",  low: "97",  close: "100", volume: "1000" }, // 전주 금 ← weekStartClose
      ];

      setupDbMock({
        "^GSPC": rows, "^IXIC": rows, "^DJI": rows, "^RUT": rows, "^VIX": rows,
      });

      mockFetch.mockImplementation(async (url: string) => {
        if (typeof url === "string" && url.includes("cnn.io")) {
          return makeFearGreedResponse();
        }
        return makeFailedResponse();
      });

      const result = JSON.parse(
        await getIndexReturns.execute({ mode: "weekly" }),
      );
      expect(result.indices[0].closePosition).toBe("near_high");
    });

    it("closePosition이 near_low로 정확히 계산된다", async () => {
      // 이번주(2026-03-30 월, 2026-03-31 화) + 전주(2026-03-27 금)
      // 이번주 weekHigh=110, weekLow=100, weekEndClose=102
      // (102-100)/(110-100)=0.2 → near_low
      const rows = [
        { date: "2026-03-31", open: "101", high: "103", low: "101", close: "102", volume: "1000" }, // 화
        { date: "2026-03-30", open: "103", high: "110", low: "100", close: "103", volume: "1000" }, // 월
        { date: "2026-03-27", open: "98",  high: "99",  low: "97",  close: "100", volume: "1000" }, // 전주 금 ← weekStartClose
      ];

      setupDbMock({
        "^GSPC": rows, "^IXIC": rows, "^DJI": rows, "^RUT": rows, "^VIX": rows,
      });

      mockFetch.mockImplementation(async (url: string) => {
        if (typeof url === "string" && url.includes("cnn.io")) {
          return makeFearGreedResponse();
        }
        return makeFailedResponse();
      });

      const result = JSON.parse(
        await getIndexReturns.execute({ mode: "weekly" }),
      );
      expect(result.indices[0].closePosition).toBe("near_low");
    });

    it("closePosition이 mid로 정확히 계산된다", async () => {
      // 이번주(2026-03-30 월, 2026-03-31 화) + 전주(2026-03-27 금)
      // 이번주 weekHigh=110, weekLow=100, weekEndClose=105
      // (105-100)/(110-100)=0.5 → mid
      const rows = [
        { date: "2026-03-31", open: "104", high: "106", low: "104", close: "105", volume: "1000" }, // 화
        { date: "2026-03-30", open: "103", high: "110", low: "100", close: "103", volume: "1000" }, // 월
        { date: "2026-03-27", open: "98",  high: "99",  low: "97",  close: "100", volume: "1000" }, // 전주 금 ← weekStartClose
      ];

      setupDbMock({
        "^GSPC": rows, "^IXIC": rows, "^DJI": rows, "^RUT": rows, "^VIX": rows,
      });

      mockFetch.mockImplementation(async (url: string) => {
        if (typeof url === "string" && url.includes("cnn.io")) {
          return makeFearGreedResponse();
        }
        return makeFailedResponse();
      });

      const result = JSON.parse(
        await getIndexReturns.execute({ mode: "weekly" }),
      );
      expect(result.indices[0].closePosition).toBe("mid");
    });

    it("close 데이터가 2개 미만이면 해당 지수를 건너뛴다", async () => {
      // DB에 1건만 — weekly 계산 불가
      const rows = [
        { date: "2026-03-24", open: "5000", high: "5010", low: "4990", close: "5000", volume: "1000" },
      ];

      setupDbMock({
        "^GSPC": rows, "^IXIC": rows, "^DJI": rows, "^RUT": rows, "^VIX": rows,
      });

      // FMP fallback도 1건만 반환
      mockFetchJson.mockResolvedValue({
        historical: [
          { date: "2026-03-24", open: 5000, high: 5010, low: 4990, close: 5000, volume: 1000 },
        ],
      });

      mockFetch.mockImplementation(async (url: string) => {
        if (typeof url === "string" && url.includes("cnn.io")) {
          return makeFearGreedResponse();
        }
        return makeFailedResponse();
      });

      const result = JSON.parse(
        await getIndexReturns.execute({ mode: "weekly" }),
      );

      expect(result.indices).toHaveLength(0);
      expect(result.fearGreed).not.toBeNull();
    });

    it("weekly 모드에서도 fearGreed가 포함된다", async () => {
      const rows = makeDbRows([5100, 5050, 5000]);
      setupDbMock({
        "^GSPC": rows, "^IXIC": rows, "^DJI": rows, "^RUT": rows, "^VIX": rows,
      });

      mockFetch.mockImplementation(async (url: string) => {
        if (typeof url === "string" && url.includes("cnn.io")) {
          return makeFearGreedResponse(72, "Greed");
        }
        return makeFailedResponse();
      });

      const result = JSON.parse(
        await getIndexReturns.execute({ mode: "weekly" }),
      );

      expect(result.fearGreed).toEqual({
        score: 72,
        rating: "Greed",
        previousClose: 44,
        previous1Week: 40,
        previous1Month: 50,
      });
    });

    it("모든 지수 실패 + fearGreed 실패 시 에러를 반환한다", async () => {
      // DB 빈 결과 + FMP도 빈 결과
      setupDbMock({
        "^GSPC": [], "^IXIC": [], "^DJI": [], "^RUT": [], "^VIX": [],
      });
      mockFetchJson.mockResolvedValue({ historical: [] });
      mockFetch.mockImplementation(async () => makeFailedResponse());

      const result = JSON.parse(
        await getIndexReturns.execute({ mode: "weekly" }),
      );

      expect(result.error).toBe("시장 데이터를 가져올 수 없습니다");
      expect(result.mode).toBe("weekly");
      expect(result.indices).toHaveLength(0);
      expect(result.fearGreed).toBeNull();
    });
  });
});
