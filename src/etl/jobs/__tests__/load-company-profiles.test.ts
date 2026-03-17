import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── DB/외부 의존성 mock ──────────────────────────────────────────────────────
// vi.mock factory는 호이스팅되므로 vi.hoisted()로 shared mock 선언
const { mockInsert, mockExecute, mockFetchJson, mockSleep } = vi.hoisted(() => ({
  mockInsert: vi.fn(),
  mockExecute: vi.fn(),
  mockFetchJson: vi.fn(),
  mockSleep: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/db/client", () => ({
  db: {
    insert: mockInsert,
    execute: mockExecute,
  },
  pool: { end: vi.fn() },
}));
vi.mock("dotenv/config", () => ({}));
vi.mock("@/etl/utils/validation", () => ({
  validateEnvironmentVariables: vi.fn().mockReturnValue({ isValid: true, errors: [], warnings: [] }),
}));
vi.mock("@/etl/utils/retry", () => ({
  retryApiCall: vi.fn((fn: () => unknown) => fn()),
  retryDatabaseOperation: vi.fn((fn: () => unknown) => fn()),
  DEFAULT_RETRY_OPTIONS: {},
}));
vi.mock("@/agent/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/etl/utils/common", () => ({
  fetchJson: mockFetchJson,
  sleep: mockSleep,
}));


import { loadCompanyProfiles } from "../load-company-profiles.js";

const MOCK_PROFILE_ROW = {
  symbol: "NVDA",
  companyName: "NVIDIA Corporation",
  description: "A semiconductor company.",
  ceo: "Jensen Huang",
  fullTimeEmployees: "29600",
  mktCap: "1500000000000",
  sector: "Technology",
  industry: "Semiconductors",
  website: "https://www.nvidia.com",
  country: "US",
  exchangeShortName: "NASDAQ",
  ipoDate: "1999-01-22",
};

describe("load-company-profiles", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    process.env.DATA_API = "https://financialmodelingprep.com";
    process.env.FMP_API_KEY = "test-api-key-12345";

    // DB insert chain mock
    const onConflictMock = vi.fn().mockResolvedValue(undefined);
    const valuesMock = vi.fn().mockReturnValue({ onConflictDoUpdate: onConflictMock });
    mockInsert.mockReturnValue({ values: valuesMock });

    // DB execute mock (추천 종목 조회)
    mockExecute.mockResolvedValue({ rows: [{ symbol: "NVDA" }] });
  });

  afterEach(() => {
    delete process.env.DATA_API;
    delete process.env.FMP_API_KEY;
  });

  it("프로필 데이터를 정상적으로 fetch하고 UPSERT한다", async () => {
    mockFetchJson.mockResolvedValue([MOCK_PROFILE_ROW]);

    await loadCompanyProfiles();

    expect(mockFetchJson).toHaveBeenCalledOnce();
    expect(mockFetchJson).toHaveBeenCalledWith(
      expect.stringContaining("/stable/profile?symbol=NVDA"),
    );
    expect(mockInsert).toHaveBeenCalledOnce();
  });

  it("빈 응답은 해당 종목을 skip 처리한다", async () => {
    mockFetchJson.mockResolvedValue([]);

    await loadCompanyProfiles();

    // DB insert가 호출되지 않아야 한다
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("추천 종목이 없으면 API를 호출하지 않는다", async () => {
    mockExecute.mockResolvedValue({ rows: [] });

    await loadCompanyProfiles();

    expect(mockFetchJson).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
  });
});
