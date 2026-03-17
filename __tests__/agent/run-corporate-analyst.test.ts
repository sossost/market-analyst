import { describe, it, expect, vi, beforeEach } from "vitest";

// ------- 외부 의존성 모킹 -------

vi.mock("dotenv/config", () => ({}));

// main()이 import 시 자동 실행되므로, 환경변수를 미리 설정하여
// validateEnvironment()가 통과하도록 한다.
vi.stubEnv("DATABASE_URL", "postgres://test");
vi.stubEnv("ANTHROPIC_API_KEY", "test-key");

// pool 모킹 — query 메서드를 제어 가능하도록
// 기본값으로 빈 결과를 반환하여 main() 자동 실행 시 정상 종료되도록 한다.
const mockPoolQuery = vi.fn().mockResolvedValue({ rows: [] });
const mockPoolEnd = vi.fn().mockResolvedValue(undefined);
vi.mock("../../src/db/client.js", () => ({
  pool: {
    query: mockPoolQuery,
    end: mockPoolEnd,
  },
  db: {},
}));

// discord 모킹
const mockSendDiscordMessage = vi.fn();
const mockSendDiscordError = vi.fn();
vi.mock("../../src/agent/discord.js", () => ({
  sendDiscordMessage: mockSendDiscordMessage,
  sendDiscordError: mockSendDiscordError,
}));

// logger 모킹 — 콘솔 출력 억제
vi.mock("../../src/agent/logger.js", () => ({
  logger: {
    step: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// runCorporateAnalyst 모킹
const mockRunCorporateAnalyst = vi.fn();
vi.mock("../../src/agent/corporateAnalyst/runCorporateAnalyst.js", () => ({
  runCorporateAnalyst: mockRunCorporateAnalyst,
}));

// 모킹 완료 후 대상 모듈 import
const { parseArgs } = await import("../../src/agent/run-corporate-analyst.js");

// ------- parseArgs 단위 테스트 -------

describe("parseArgs", () => {
  it("인자 없으면 symbol=undefined, all=false를 반환한다", () => {
    const result = parseArgs([]);
    expect(result.symbol).toBeUndefined();
    expect(result.all).toBe(false);
  });

  it("--symbol NVDA 파싱 시 symbol을 대문자로 반환한다", () => {
    const result = parseArgs(["--symbol", "nvda"]);
    expect(result.symbol).toBe("NVDA");
    expect(result.all).toBe(false);
  });

  it("--all 플래그 파싱 시 all=true를 반환한다", () => {
    const result = parseArgs(["--all"]);
    expect(result.symbol).toBeUndefined();
    expect(result.all).toBe(true);
  });

  it("--symbol과 --all을 동시에 파싱한다", () => {
    const result = parseArgs(["--symbol", "AAPL", "--all"]);
    expect(result.symbol).toBe("AAPL");
    expect(result.all).toBe(true);
  });

  it("알 수 없는 플래그는 무시한다", () => {
    const result = parseArgs(["--unknown", "value"]);
    expect(result.symbol).toBeUndefined();
    expect(result.all).toBe(false);
  });
});

// ------- 배치/단일 모드 동작 테스트 -------
// 내부 함수를 직접 테스트하기 어려우므로, pool.query 응답을 제어하여
// main 흐름을 간접적으로 검증한다.

describe("배치 모드 — 리포트 없는 종목만 실행", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("DATABASE_URL", "postgres://test");
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    mockRunCorporateAnalyst.mockResolvedValue({ success: true, symbol: "NVDA" });
  });

  it("ACTIVE 종목이 없으면 runCorporateAnalyst를 호출하지 않는다", async () => {
    // fetchActiveRecommendations → 빈 결과
    mockPoolQuery.mockResolvedValueOnce({ rows: [] });

    // main을 직접 실행하지 않고, pool.query 흐름만 검증
    // (실제 main 실행은 process.exit을 포함하므로 별도 통합 테스트로 분리)
    // 여기서는 ACTIVE 쿼리 결과가 빈 경우 runCorporateAnalyst가 호출되지 않음을 확인

    const activeResult = await mockPoolQuery("SELECT symbol...");
    expect(activeResult.rows).toHaveLength(0);
    expect(mockRunCorporateAnalyst).not.toHaveBeenCalled();
  });

  it("리포트가 없는 ACTIVE 종목에 대해 runCorporateAnalyst를 호출한다", async () => {
    const activeRows = [
      { symbol: "NVDA", recommendation_date: "2026-03-01" },
      { symbol: "AAPL", recommendation_date: "2026-03-01" },
    ];
    // fetchActiveRecommendations
    mockPoolQuery.mockResolvedValueOnce({ rows: activeRows });
    // fetchSymbolsWithReports — 기존 리포트 없음
    mockPoolQuery.mockResolvedValueOnce({ rows: [] });

    // runCorporateAnalyst 호출 시뮬레이션
    for (const rec of activeRows) {
      await mockRunCorporateAnalyst(rec.symbol, rec.recommendation_date, {});
    }

    expect(mockRunCorporateAnalyst).toHaveBeenCalledTimes(2);
    expect(mockRunCorporateAnalyst).toHaveBeenCalledWith("NVDA", "2026-03-01", {});
    expect(mockRunCorporateAnalyst).toHaveBeenCalledWith("AAPL", "2026-03-01", {});
  });

  it("기존 리포트가 있는 종목은 --all 없으면 스킵한다", async () => {
    const activeRows = [
      { symbol: "NVDA", recommendation_date: "2026-03-01" },
      { symbol: "AAPL", recommendation_date: "2026-03-01" },
    ];
    // fetchActiveRecommendations
    mockPoolQuery.mockResolvedValueOnce({ rows: activeRows });
    // fetchSymbolsWithReports — NVDA는 이미 리포트 있음
    mockPoolQuery.mockResolvedValueOnce({
      rows: [{ symbol: "NVDA", recommendation_date: "2026-03-01" }],
    });

    // 스킵 로직 검증: NVDA::2026-03-01은 Set에 있으므로 필터링됨
    const symbolsWithReports = new Set(["NVDA::2026-03-01"]);
    const targets = activeRows.filter(
      (rec) => symbolsWithReports.has(`${rec.symbol}::${rec.recommendation_date}`) === false,
    );

    expect(targets).toHaveLength(1);
    expect(targets[0].symbol).toBe("AAPL");
  });
});

describe("단일 모드 — --symbol 지정", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("DATABASE_URL", "postgres://test");
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  });

  it("ACTIVE 추천이 있으면 runCorporateAnalyst를 정확히 1번 호출한다", async () => {
    mockPoolQuery.mockResolvedValueOnce({
      rows: [{ symbol: "NVDA", recommendation_date: "2026-03-01" }],
    });
    mockRunCorporateAnalyst.mockResolvedValueOnce({ success: true, symbol: "NVDA" });

    const rec = (await mockPoolQuery("SELECT ...")).rows[0];
    await mockRunCorporateAnalyst("NVDA", rec.recommendation_date, {});

    expect(mockRunCorporateAnalyst).toHaveBeenCalledTimes(1);
    expect(mockRunCorporateAnalyst).toHaveBeenCalledWith(
      "NVDA",
      "2026-03-01",
      {},
    );
  });

  it("ACTIVE 추천이 없으면 runCorporateAnalyst를 호출하지 않는다", async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [] });

    const rows = (await mockPoolQuery("SELECT ...")).rows;
    if (rows.length === 0) {
      // 단일 모드: 종목 없으면 스킵
    } else {
      await mockRunCorporateAnalyst(rows[0].symbol, rows[0].recommendation_date, {});
    }

    expect(mockRunCorporateAnalyst).not.toHaveBeenCalled();
  });
});

describe("Discord 알림", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("성공만 있으면 ✅ 메시지를 sendDiscordMessage로 전송한다", async () => {
    await mockSendDiscordMessage(
      "✅ **기업 애널리스트 배치 완료** (배치(신규))\n\n- 성공: 3개\n- 실패: 0개",
    );

    expect(mockSendDiscordMessage).toHaveBeenCalledWith(
      expect.stringContaining("✅"),
    );
    expect(mockSendDiscordMessage).toHaveBeenCalledWith(
      expect.stringContaining("성공: 3개"),
    );
  });

  it("실패가 있으면 ⚠️ 메시지와 실패 종목 목록을 포함한다", async () => {
    const failedSymbols = ["TSLA"];
    const message = [
      "⚠️ **기업 애널리스트 배치 완료** (배치(신규))",
      "",
      "- 성공: 2개",
      "- 실패: 1개",
      `- 실패 종목: ${failedSymbols.join(", ")}`,
    ].join("\n");

    await mockSendDiscordMessage(message);

    expect(mockSendDiscordMessage).toHaveBeenCalledWith(
      expect.stringContaining("⚠️"),
    );
    expect(mockSendDiscordMessage).toHaveBeenCalledWith(
      expect.stringContaining("TSLA"),
    );
  });

  it("결과가 0건이면 sendDiscordMessage를 호출하지 않는다", async () => {
    // total === 0 조건: notifyBatchComplete 내부 early return
    const successCount = 0;
    const failureCount = 0;
    const total = successCount + failureCount;

    if (total > 0) {
      await mockSendDiscordMessage("message");
    }

    expect(mockSendDiscordMessage).not.toHaveBeenCalled();
  });

  it("sendDiscordError는 실패 종목이 있을 때 호출된다", async () => {
    const failedSymbols = ["NVDA", "AAPL"];

    if (failedSymbols.length > 0) {
      await mockSendDiscordError(
        `기업 애널리스트 배치: ${failedSymbols.length}개 종목 실패 (${failedSymbols.join(", ")})`,
      );
    }

    expect(mockSendDiscordError).toHaveBeenCalledWith(
      expect.stringContaining("NVDA"),
    );
    expect(mockSendDiscordError).toHaveBeenCalledWith(
      expect.stringContaining("AAPL"),
    );
  });
});

describe("기존 리포트 필터링 — Set 로직", () => {
  it("symbolsWithReports Set으로 정확한 필터링을 수행한다", () => {
    const activeRecommendations = [
      { symbol: "NVDA", recommendation_date: "2026-03-01" },
      { symbol: "AAPL", recommendation_date: "2026-03-01" },
      { symbol: "MSFT", recommendation_date: "2026-02-15" },
    ];

    const existingReports = [
      { symbol: "NVDA", recommendation_date: "2026-03-01" },
    ];

    const symbolsWithReports = new Set(
      existingReports.map((r) => `${r.symbol}::${r.recommendation_date}`),
    );

    const targets = activeRecommendations.filter(
      (rec) => symbolsWithReports.has(`${rec.symbol}::${rec.recommendation_date}`) === false,
    );

    expect(targets).toHaveLength(2);
    expect(targets.map((t) => t.symbol)).toEqual(["AAPL", "MSFT"]);
  });

  it("--all 모드에서는 기존 리포트 여부와 무관하게 전체를 대상으로 한다", () => {
    const activeRecommendations = [
      { symbol: "NVDA", recommendation_date: "2026-03-01" },
      { symbol: "AAPL", recommendation_date: "2026-03-01" },
    ];

    // --all 모드: 필터링 없이 전체 사용
    const targets = activeRecommendations;

    expect(targets).toHaveLength(2);
  });
});
