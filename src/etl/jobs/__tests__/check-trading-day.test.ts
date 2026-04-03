import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// vi.hoisted로 mock 함수 선언
const { mockExecute, mockPoolEnd, mockSendDiscordMessage } = vi.hoisted(() => ({
  mockExecute: vi.fn(),
  mockPoolEnd: vi.fn().mockResolvedValue(undefined),
  mockSendDiscordMessage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/db/client", () => ({
  db: { execute: mockExecute },
  pool: { end: mockPoolEnd },
}));
vi.mock("dotenv/config", () => ({}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/discord", () => ({
  sendDiscordMessage: mockSendDiscordMessage,
}));

import { getExpectedTradingDate, main } from "../check-trading-day.js";

// UTC 날짜 문자열로 Date 객체 생성
function utcDate(dateStr: string, hour = 0): Date {
  return new Date(`${dateStr}T${String(hour).padStart(2, "0")}:00:00Z`);
}

describe("getExpectedTradingDate()", () => {
  describe("ETL 실제 실행 시점 (KST 07:00 = ET 전날 17:00)", () => {
    it("화 KST 07:00 → 월요일 반환 (ET 월 17:00, 월요일 데이터)", () => {
      const etlTime = utcDate("2026-03-30", 22);
      expect(getExpectedTradingDate(etlTime)).toBe("2026-03-30");
    });

    it("수 KST 07:00 → 화요일 반환 (ET 화 17:00)", () => {
      const etlTime = utcDate("2026-03-31", 22);
      expect(getExpectedTradingDate(etlTime)).toBe("2026-03-31");
    });

    it("토 KST 07:00 → 금요일 반환 (ET 금 17:00, 금요일 데이터)", () => {
      const etlTime = utcDate("2026-04-03", 22);
      expect(getExpectedTradingDate(etlTime)).toBe("2026-04-03");
    });
  });

  describe("ET 기준 평일 → 해당 날짜 반환", () => {
    it("월요일(ET) → 월요일 반환", () => {
      const monday = utcDate("2026-03-30", 12);
      expect(getExpectedTradingDate(monday)).toBe("2026-03-30");
    });

    it("화요일(ET) → 화요일 반환", () => {
      const tuesday = utcDate("2026-03-31", 12);
      expect(getExpectedTradingDate(tuesday)).toBe("2026-03-31");
    });

    it("수요일(ET) → 수요일 반환", () => {
      const wednesday = utcDate("2026-04-01", 12);
      expect(getExpectedTradingDate(wednesday)).toBe("2026-04-01");
    });

    it("목요일(ET) → 목요일 반환", () => {
      const thursday = utcDate("2026-04-02", 12);
      expect(getExpectedTradingDate(thursday)).toBe("2026-04-02");
    });

    it("금요일(ET) → 금요일 반환", () => {
      const friday = utcDate("2026-04-03", 12);
      expect(getExpectedTradingDate(friday)).toBe("2026-04-03");
    });
  });

  describe("ET 기준 주말 → 금요일 반환", () => {
    it("토요일(ET) → 직전 금요일 반환", () => {
      const saturday = utcDate("2026-04-04", 12);
      expect(getExpectedTradingDate(saturday)).toBe("2026-04-03");
    });

    it("일요일(ET) → 직전 금요일 반환", () => {
      const sunday = utcDate("2026-04-05", 12);
      expect(getExpectedTradingDate(sunday)).toBe("2026-04-03");
    });
  });

  describe("월 경계 처리", () => {
    it("월 1일(ET 수요일) → 4/1 반환", () => {
      const april1 = utcDate("2026-04-01", 12);
      expect(getExpectedTradingDate(april1)).toBe("2026-04-01");
    });

    it("연초 1/1(ET 목요일) → 1/1 반환", () => {
      const jan1 = utcDate("2026-01-01", 12);
      expect(getExpectedTradingDate(jan1)).toBe("2026-01-01");
    });
  });
});

describe("main() 통합 테스트", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPoolEnd.mockResolvedValue(undefined);
    mockSendDiscordMessage.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("DB MAX(date)가 기대 날짜와 일치 → exit code 0 (거래일)", async () => {
    vi.setSystemTime(utcDate("2026-03-31", 12)); // ET 화요일 → 기대 = 2026-03-31
    mockExecute.mockResolvedValue({ rows: [{ result_date: "2026-03-31" }] });

    const code = await main();
    expect(code).toBe(0);
    expect(mockPoolEnd).toHaveBeenCalled();
  });

  it("DB MAX(date)가 기대 날짜와 불일치 → Discord 알림 + exit code 2 (휴일)", async () => {
    vi.setSystemTime(utcDate("2026-03-31", 12)); // ET 화요일 → 기대 = 2026-03-31
    mockExecute.mockResolvedValue({ rows: [{ result_date: "2026-03-28" }] }); // 월요일 휴일

    const code = await main();
    expect(code).toBe(2);
    expect(mockSendDiscordMessage).toHaveBeenCalledWith(
      expect.stringContaining("미장 휴일 감지"),
      "DISCORD_ERROR_WEBHOOK_URL",
    );
    expect(mockPoolEnd).toHaveBeenCalled();
  });

  it("DB에 데이터 없음 (null) → exit code 1", async () => {
    mockExecute.mockResolvedValue({ rows: [{ result_date: null }] });

    const code = await main();
    expect(code).toBe(1);
    expect(mockPoolEnd).toHaveBeenCalled();
  });

  it("DB 쿼리 예외 → exit code 1", async () => {
    mockExecute.mockRejectedValue(new Error("connection refused"));

    const code = await main();
    expect(code).toBe(1);
    expect(mockPoolEnd).toHaveBeenCalled();
  });

  it("Discord 알림 실패해도 exit code 2로 정상 스킵", async () => {
    vi.setSystemTime(utcDate("2026-03-31", 12));
    mockExecute.mockResolvedValue({ rows: [{ result_date: "2026-03-28" }] });
    mockSendDiscordMessage.mockRejectedValue(new Error("webhook down"));

    const code = await main();
    expect(code).toBe(2);
  });
});
