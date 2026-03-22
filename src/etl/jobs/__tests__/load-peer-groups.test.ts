import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── DB/외부 의존성 mock ──────────────────────────────────────────────────────
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
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/etl/utils/common", () => ({
  fetchJson: mockFetchJson,
  sleep: mockSleep,
}));


import { loadPeerGroups } from "../load-peer-groups.js";

const MOCK_PEERS_RESPONSE = [
  {
    symbol: "NVDA",
    peersList: ["AMD", "INTC", "QCOM", "MRVL", "AVGO"],
  },
];

describe("load-peer-groups", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    process.env.DATA_API = "https://financialmodelingprep.com";
    process.env.FMP_API_KEY = "test-api-key-12345";

    const onConflictMock = vi.fn().mockResolvedValue(undefined);
    const valuesMock = vi.fn().mockReturnValue({ onConflictDoUpdate: onConflictMock });
    mockInsert.mockReturnValue({ values: valuesMock });

    mockExecute.mockResolvedValue({ rows: [{ symbol: "NVDA" }] });
  });

  afterEach(() => {
    delete process.env.DATA_API;
    delete process.env.FMP_API_KEY;
  });

  it("피어 목록을 fetch하고 JSONB 배열로 UPSERT한다", async () => {
    mockFetchJson.mockResolvedValue(MOCK_PEERS_RESPONSE);

    await loadPeerGroups();

    expect(mockFetchJson).toHaveBeenCalledOnce();
    expect(mockFetchJson).toHaveBeenCalledWith(
      expect.stringContaining("/api/v4/stock_peers?symbol=NVDA"),
    );
    expect(mockInsert).toHaveBeenCalledOnce();

    // peers 배열이 올바르게 전달되었는지 확인
    const valuesMock = mockInsert.mock.results[0].value.values;
    const insertedData = valuesMock.mock.calls[0][0];
    expect(insertedData.peers).toEqual(["AMD", "INTC", "QCOM", "MRVL", "AVGO"]);
  });

  it("/api/v4/ 경로를 사용한다 (stable 아님)", async () => {
    mockFetchJson.mockResolvedValue(MOCK_PEERS_RESPONSE);

    await loadPeerGroups();

    const calledUrl = mockFetchJson.mock.calls[0][0] as string;
    expect(calledUrl).toContain("/api/v4/stock_peers");
    expect(calledUrl).not.toContain("/stable/stock_peers");
  });

  it("peersList가 빈 배열이어도 저장한다", async () => {
    mockFetchJson.mockResolvedValue([{ symbol: "NVDA", peersList: [] }]);

    await loadPeerGroups();

    const valuesMock = mockInsert.mock.results[0].value.values;
    const insertedData = valuesMock.mock.calls[0][0];
    expect(insertedData.peers).toEqual([]);
  });

  it("빈 응답은 해당 종목을 skip 처리한다", async () => {
    mockFetchJson.mockResolvedValue([]);

    await loadPeerGroups();

    expect(mockInsert).not.toHaveBeenCalled();
  });
});
