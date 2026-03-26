import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── DB/외부 의존성 mock ──────────────────────────────────────────────────────
const { mockInsert, mockFetchJson } = vi.hoisted(() => ({
  mockInsert: vi.fn(),
  mockFetchJson: vi.fn(),
}));

vi.mock("@/db/client", () => ({
  db: {
    insert: mockInsert,
  },
  pool: { end: vi.fn() },
}));
vi.mock("dotenv/config", () => ({}));
vi.mock("@/etl/utils/validation", () => ({
  validateEnvironmentVariables: vi.fn().mockReturnValue({ isValid: true, errors: [], warnings: [] }),
  validateSymbolData: vi.fn().mockReturnValue({ isValid: true, errors: [] }),
}));
vi.mock("@/etl/utils/retry", () => ({
  retryApiCall: vi.fn((fn: () => unknown) => fn()),
  DEFAULT_RETRY_OPTIONS: {},
}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/etl/utils/common", () => ({
  fetchJson: mockFetchJson,
  isValidTicker: vi.fn((s: string) => /^[A-Z]{1,5}$/.test(s)),
}));

import { loadUSSymbols } from "../load-us-symbols.js";

function makeSymbol(overrides: Record<string, unknown> = {}) {
  return {
    symbol: "AAPL",
    companyName: "Apple Inc.",
    marketCap: 3000000000000,
    sector: "Technology",
    industry: "Consumer Electronics",
    beta: 1.2,
    price: 180,
    lastAnnualDividend: 0.96,
    volume: 50000000,
    exchange: "NASDAQ",
    exchangeShortName: "NASDAQ",
    country: "US",
    isEtf: false,
    isFund: false,
    isActivelyTrading: true,
    ...overrides,
  };
}

describe("load-us-symbols", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATA_API = "https://financialmodelingprep.com";
    process.env.FMP_API_KEY = "test-key";

    // Default: insert chain returns resolved
    const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
    const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
    mockInsert.mockReturnValue({ values });
  });

  it("filters out Shell Companies (SPAC)", async () => {
    const normalStock = makeSymbol({ symbol: "AAPL" });
    const shellCompany = makeSymbol({
      symbol: "IPOF",
      industry: "Shell Companies",
      sector: "Financial Services",
    });

    mockFetchJson
      .mockResolvedValueOnce([normalStock, shellCompany]) // NASDAQ
      .mockResolvedValueOnce([])  // NYSE
      .mockResolvedValueOnce([]); // AMEX

    await loadUSSymbols();

    const insertCall = mockInsert.mock.calls[0];
    expect(insertCall).toBeDefined();

    // values() 호출에서 Shell Companies가 제외되었는지 확인
    const valuesCall = mockInsert.mock.results[0].value.values.mock.calls[0][0];
    const insertedSymbols = valuesCall.map((r: { symbol: string }) => r.symbol);

    expect(insertedSymbols).toContain("AAPL");
    expect(insertedSymbols).not.toContain("IPOF");
  });

  it("filters out ETFs and Funds", async () => {
    const etf = makeSymbol({ symbol: "SPY", isEtf: true });
    const fund = makeSymbol({ symbol: "VFIAX", isFund: true });
    const normal = makeSymbol({ symbol: "MSFT" });

    mockFetchJson
      .mockResolvedValueOnce([etf, fund, normal])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    await loadUSSymbols();

    const valuesCall = mockInsert.mock.results[0].value.values.mock.calls[0][0];
    const insertedSymbols = valuesCall.map((r: { symbol: string }) => r.symbol);

    expect(insertedSymbols).toContain("MSFT");
    expect(insertedSymbols).not.toContain("SPY");
    expect(insertedSymbols).not.toContain("VFIAX");
  });

  it("allows normal Financial Services stocks", async () => {
    const normalFinancial = makeSymbol({
      symbol: "JPM",
      sector: "Financial Services",
      industry: "Banks—Diversified",
    });

    mockFetchJson
      .mockResolvedValueOnce([normalFinancial])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    await loadUSSymbols();

    const valuesCall = mockInsert.mock.results[0].value.values.mock.calls[0][0];
    const insertedSymbols = valuesCall.map((r: { symbol: string }) => r.symbol);

    expect(insertedSymbols).toContain("JPM");
  });
});
