import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

vi.mock("@/agent/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

function makeYahooResponse(quotes: {
  close: (number | null)[];
  high?: (number | null)[];
  low?: (number | null)[];
  meta?: { regularMarketPrice: number; chartPreviousClose: number };
}) {
  const validCloses = quotes.close.filter((c): c is number => c != null);
  const lastClose = validCloses[validCloses.length - 1] ?? 0;
  const prevClose = validCloses.length >= 2 ? validCloses[validCloses.length - 2] : lastClose;

  return {
    ok: true,
    json: async () => ({
      chart: {
        result: [
          {
            meta: quotes.meta ?? {
              regularMarketPrice: lastClose,
              chartPreviousClose: prevClose,
            },
            indicators: {
              quote: [
                {
                  close: quotes.close,
                  high: quotes.high ?? quotes.close,
                  low: quotes.low ?? quotes.close,
                },
              ],
            },
          },
        ],
      },
    }),
  };
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

describe("getIndexReturns", () => {
  let getIndexReturns: typeof import("@/agent/tools/getIndexReturns").getIndexReturns;

  beforeEach(async () => {
    vi.resetModules();
    mockFetch.mockReset();
    const mod = await import("@/agent/tools/getIndexReturns");
    getIndexReturns = mod.getIndexReturns;
  });

  describe("daily mode (default)", () => {
    it("mode 미지정 시 daily 동작 — 일간 등락률 반환", async () => {
      // 5 index symbols + 1 fear/greed = 6 fetch calls
      mockFetch.mockImplementation(async (url: string) => {
        if (typeof url === "string" && url.includes("cnn.io")) {
          return makeFearGreedResponse();
        }
        return makeYahooResponse({ close: [5000, 5050] });
      });

      const result = JSON.parse(await getIndexReturns.execute({}));

      expect(result.indices).toHaveLength(5);
      expect(result.indices[0]).toHaveProperty("close");
      expect(result.indices[0]).toHaveProperty("change");
      expect(result.indices[0]).toHaveProperty("changePercent");
      expect(result.indices[0]).not.toHaveProperty("weekStartClose");
      expect(result.fearGreed).not.toBeNull();
      expect(result.mode).toBeUndefined();
    });

    it("mode: 'daily' 명시 시에도 daily 동작", async () => {
      mockFetch.mockImplementation(async (url: string) => {
        if (typeof url === "string" && url.includes("cnn.io")) {
          return makeFearGreedResponse();
        }
        return makeYahooResponse({ close: [5000, 5050] });
      });

      const result = JSON.parse(
        await getIndexReturns.execute({ mode: "daily" }),
      );

      expect(result.indices).toHaveLength(5);
      expect(result.indices[0]).toHaveProperty("changePercent");
      expect(result.indices[0]).not.toHaveProperty("weeklyChangePercent");
    });
  });

  describe("weekly mode", () => {
    it("주간 누적 수익률을 올바르게 계산", async () => {
      mockFetch.mockImplementation(async (url: string) => {
        if (typeof url === "string" && url.includes("cnn.io")) {
          return makeFearGreedResponse();
        }
        // 5일치 데이터: 5000 → 5250 (5% 상승)
        return makeYahooResponse({
          close: [5000, 5050, 5100, 5200, 5250],
          high: [5010, 5060, 5120, 5220, 5260],
          low: [4990, 5030, 5080, 5180, 5230],
        });
      });

      const result = JSON.parse(
        await getIndexReturns.execute({ mode: "weekly" }),
      );

      expect(result.mode).toBe("weekly");
      expect(result.indices).toHaveLength(5);

      const index = result.indices[0];
      expect(index.weekStartClose).toBe(5000);
      expect(index.weekEndClose).toBe(5250);
      expect(index.weeklyChange).toBe(250);
      expect(index.weeklyChangePercent).toBe(5);
      expect(index.weekHigh).toBe(5260);
      expect(index.weekLow).toBe(4990);
      expect(index.tradingDays).toBe(5);
    });

    it("closePosition이 near_high로 정확히 계산", async () => {
      // weekHigh=110, weekLow=100, weekEndClose=108 → (108-100)/(110-100)=0.8 → near_high
      mockFetch.mockImplementation(async (url: string) => {
        if (typeof url === "string" && url.includes("cnn.io")) {
          return makeFearGreedResponse();
        }
        return makeYahooResponse({
          close: [100, 105, 108],
          high: [102, 110, 109],
          low: [100, 103, 106],
        });
      });

      const result = JSON.parse(
        await getIndexReturns.execute({ mode: "weekly" }),
      );
      expect(result.indices[0].closePosition).toBe("near_high");
    });

    it("closePosition이 near_low로 정확히 계산", async () => {
      // weekHigh=110, weekLow=100, weekEndClose=102 → (102-100)/(110-100)=0.2 → near_low
      mockFetch.mockImplementation(async (url: string) => {
        if (typeof url === "string" && url.includes("cnn.io")) {
          return makeFearGreedResponse();
        }
        return makeYahooResponse({
          close: [105, 103, 102],
          high: [110, 104, 103],
          low: [100, 101, 101],
        });
      });

      const result = JSON.parse(
        await getIndexReturns.execute({ mode: "weekly" }),
      );
      expect(result.indices[0].closePosition).toBe("near_low");
    });

    it("closePosition이 mid로 정확히 계산", async () => {
      // weekHigh=110, weekLow=100, weekEndClose=105 → (105-100)/(110-100)=0.5 → mid
      mockFetch.mockImplementation(async (url: string) => {
        if (typeof url === "string" && url.includes("cnn.io")) {
          return makeFearGreedResponse();
        }
        return makeYahooResponse({
          close: [100, 103, 105],
          high: [102, 110, 106],
          low: [100, 101, 104],
        });
      });

      const result = JSON.parse(
        await getIndexReturns.execute({ mode: "weekly" }),
      );
      expect(result.indices[0].closePosition).toBe("mid");
    });

    it("close 배열이 2개 미만이면 해당 지수 건너뜀", async () => {
      mockFetch.mockImplementation(async (url: string) => {
        if (typeof url === "string" && url.includes("cnn.io")) {
          return makeFearGreedResponse();
        }
        // 유효한 close가 1개뿐
        return makeYahooResponse({
          close: [null, null, 5000],
          high: [null, null, 5010],
          low: [null, null, 4990],
        });
      });

      const result = JSON.parse(
        await getIndexReturns.execute({ mode: "weekly" }),
      );

      // 1개만 있으면 < 2이므로 모두 건너뜀
      expect(result.indices).toHaveLength(0);
      expect(result.fearGreed).not.toBeNull();
    });

    it("weekly 모드에서도 fearGreed가 포함", async () => {
      mockFetch.mockImplementation(async (url: string) => {
        if (typeof url === "string" && url.includes("cnn.io")) {
          return makeFearGreedResponse(72, "Greed");
        }
        return makeYahooResponse({
          close: [5000, 5050, 5100],
          high: [5010, 5060, 5110],
          low: [4990, 5040, 5090],
        });
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

    it("모든 지수 실패 + fearGreed 실패 시 에러 반환", async () => {
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
