import { describe, it, expect, vi, beforeEach } from "vitest";

// ── DB mock ──────────────────────────────────────────────────

const mockSelect = vi.fn();
const mockFrom = vi.fn();
const mockWhere = vi.fn();
const mockInsert = vi.fn();
const mockValues = vi.fn();
const mockOnConflictDoNothing = vi.fn();
const mockPoolQuery = vi.fn();

vi.mock("../../src/db/client.js", () => ({
  db: {
    select: (...args: unknown[]) => {
      mockSelect(...args);
      return {
        from: (...fArgs: unknown[]) => {
          mockFrom(...fArgs);
          return {
            where: (...wArgs: unknown[]) => mockWhere(...wArgs),
          };
        },
      };
    },
    insert: (...args: unknown[]) => {
      mockInsert(...args);
      return {
        values: (...vArgs: unknown[]) => {
          mockValues(...vArgs);
          return {
            onConflictDoNothing: (...cArgs: unknown[]) =>
              mockOnConflictDoNothing(...cArgs),
          };
        },
      };
    },
  },
  pool: {
    query: (...args: unknown[]) => mockPoolQuery(...args),
  },
}));

import {
  calculateLagObservations,
  calculateLagStats,
  formatLeadingSectorsForPrompt,
  getActiveLeadingAlerts,
  MIN_SAMPLE,
  LAG_SEARCH_WINDOW_DAYS,
} from "../../src/lib/sectorLagStats.js";

describe("calculateLagObservations", () => {
  it("음수 시차를 제외한다 (팔로워가 먼저 진입한 경우)", () => {
    const leaderDates = ["2026-03-10"];
    const followerDates = ["2026-03-05"]; // 5일 전 → lag = -5

    const result = calculateLagObservations(leaderDates, followerDates);

    expect(result).toEqual([]);
  });

  it("탐색 윈도우(180일)를 초과한 팔로워를 제외한다", () => {
    const leaderDates = ["2026-01-01"];
    const followerDates = ["2026-07-15"]; // 195일 후 → 초과

    const result = calculateLagObservations(leaderDates, followerDates);

    expect(result).toEqual([]);
  });

  it("하나의 리더 이벤트에 가장 가까운 팔로워 1개만 매칭한다", () => {
    const leaderDates = ["2026-01-01"];
    const followerDates = ["2026-01-10", "2026-02-01", "2026-03-01"];

    const result = calculateLagObservations(leaderDates, followerDates);

    expect(result).toHaveLength(1);
    expect(result[0].followerDate).toBe("2026-01-10");
    expect(result[0].lagDays).toBe(9);
  });

  it("동시 진입(lag = 0)을 포함한다", () => {
    const leaderDates = ["2026-02-15"];
    const followerDates = ["2026-02-15"];

    const result = calculateLagObservations(leaderDates, followerDates);

    expect(result).toHaveLength(1);
    expect(result[0].lagDays).toBe(0);
  });

  it("팔로워 이벤트가 없으면 빈 배열을 반환한다", () => {
    const leaderDates = ["2026-01-01"];
    const followerDates: string[] = [];

    const result = calculateLagObservations(leaderDates, followerDates);

    expect(result).toEqual([]);
  });

  it("리더 이벤트가 없으면 빈 배열을 반환한다", () => {
    const leaderDates: string[] = [];
    const followerDates = ["2026-01-01"];

    const result = calculateLagObservations(leaderDates, followerDates);

    expect(result).toEqual([]);
  });

  it("여러 리더 이벤트를 각각 가장 가까운 팔로워에 매칭한다", () => {
    const leaderDates = ["2026-01-01", "2026-03-01"];
    const followerDates = ["2026-01-15", "2026-03-20"];

    const result = calculateLagObservations(leaderDates, followerDates);

    expect(result).toHaveLength(2);
    expect(result[0].leaderDate).toBe("2026-01-01");
    expect(result[0].followerDate).toBe("2026-01-15");
    expect(result[0].lagDays).toBe(14);
    expect(result[1].leaderDate).toBe("2026-03-01");
    expect(result[1].followerDate).toBe("2026-03-20");
    expect(result[1].lagDays).toBe(19);
  });

  it("윈도우 경계(180일)에 있는 팔로워를 포함한다", () => {
    const leaderDates = ["2026-01-01"];
    const followerDates = ["2026-06-30"]; // exactly 180 days

    const result = calculateLagObservations(leaderDates, followerDates);

    expect(result).toHaveLength(1);
    expect(result[0].lagDays).toBe(180);
  });
});

describe("calculateLagStats", () => {
  it("샘플 5개 미만이면 isReliable=false를 반환한다", () => {
    const lagDays = [10, 20, 30, 40]; // 4개 → MIN_SAMPLE(5) 미만

    const result = calculateLagStats(lagDays);

    expect(result).not.toBeNull();
    expect(result!.isReliable).toBe(false);
    expect(result!.sampleCount).toBe(4);
  });

  it("샘플 5개 이상이면 isReliable=true와 통계를 반환한다", () => {
    const lagDays = [10, 20, 30, 40, 50];

    const result = calculateLagStats(lagDays);

    expect(result).not.toBeNull();
    expect(result!.isReliable).toBe(true);
    expect(result!.sampleCount).toBe(5);
    expect(result!.avgLagDays).toBe(30);
    expect(result!.medianLagDays).toBe(30);
    expect(result!.minLagDays).toBe(10);
    expect(result!.maxLagDays).toBe(50);
  });

  it("빈 배열이면 null을 반환한다", () => {
    const result = calculateLagStats([]);
    expect(result).toBeNull();
  });

  it("평균과 중앙값이 올바르게 계산된다 (짝수 개)", () => {
    const lagDays = [10, 20, 30, 40, 50, 60];

    const result = calculateLagStats(lagDays);

    expect(result).not.toBeNull();
    expect(result!.avgLagDays).toBe(35);
    expect(result!.medianLagDays).toBe(35); // (30+40)/2
    expect(result!.sampleCount).toBe(6);
    expect(result!.isReliable).toBe(true);
  });

  it("동일한 값이면 표준편차가 0이다", () => {
    const lagDays = [20, 20, 20, 20, 20];

    const result = calculateLagStats(lagDays);

    expect(result).not.toBeNull();
    expect(result!.stddevLagDays).toBe(0);
    expect(result!.avgLagDays).toBe(20);
    expect(result!.medianLagDays).toBe(20);
  });

  it("표준편차를 올바르게 계산한다", () => {
    // [0, 0, 14, 14] → avg=7, variance = ((49+49+49+49)/4) = 49, stddev = 7
    const lagDays = [0, 0, 14, 14];

    const result = calculateLagStats(lagDays);

    expect(result).not.toBeNull();
    expect(result!.avgLagDays).toBe(7);
    expect(result!.stddevLagDays).toBe(7);
  });
});

describe("formatLeadingSectorsForPrompt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("신뢰 가능한 패턴이 없으면 빈 문자열을 반환한다", () => {
    // 1st where: recentLeaderEvents → empty
    mockWhere.mockResolvedValueOnce([]);

    const result = formatLeadingSectorsForPrompt("2026-03-08");

    return result.then((value) => {
      expect(value).toBe("");
    });
  });

  it("리더 이벤트는 있지만 신뢰 가능한 패턴이 없으면 빈 문자열을 반환한다", () => {
    // 1st where: recentLeaderEvents
    mockWhere.mockResolvedValueOnce([
      { entityType: "sector", entityName: "Semiconductors", date: "2026-02-28" },
    ]);
    // 2nd where: reliablePatterns → empty
    mockWhere.mockResolvedValueOnce([]);

    const result = formatLeadingSectorsForPrompt("2026-03-08");

    return result.then((value) => {
      expect(value).toBe("");
    });
  });

  it("유효한 경보가 있으면 마크다운 테이블을 반환한다", () => {
    // 1st where: recentLeaderEvents
    mockWhere.mockResolvedValueOnce([
      { entityType: "sector", entityName: "Semiconductors", date: "2026-02-28" },
    ]);
    // 2nd where: reliablePatterns
    mockWhere.mockResolvedValueOnce([
      {
        entityType: "sector",
        leaderEntity: "Semiconductors",
        followerEntity: "Semiconductor Equipment",
        transition: "1to2",
        isReliable: true,
        avgLagDays: "35",
        stddevLagDays: "14",
        sampleCount: 7,
      },
    ]);
    // pool.query: sector_rs_daily Phase 2 — 리더 자신만
    mockPoolQuery.mockResolvedValueOnce({
      rows: [{ entity_name: "Semiconductors" }],
    });
    // pool.query: industry_rs_daily Phase 2 — 없음
    mockPoolQuery.mockResolvedValueOnce({ rows: [] });

    const result = formatLeadingSectorsForPrompt("2026-03-08");

    return result.then((value) => {
      expect(value).toContain("## 섹터 시차 기반 조기 경보");
      expect(value).toContain("Semiconductors");
      expect(value).toContain("Semiconductor Equipment");
      expect(value).toContain("7회");
    });
  });

  it("팔로워가 이미 Phase 2에 있으면 경보에 포함하지 않는다", () => {
    // 1st where: recentLeaderEvents
    mockWhere.mockResolvedValueOnce([
      { entityType: "sector", entityName: "Semiconductors", date: "2026-02-28" },
    ]);
    // 2nd where: reliablePatterns
    mockWhere.mockResolvedValueOnce([
      {
        entityType: "sector",
        leaderEntity: "Semiconductors",
        followerEntity: "Semiconductor Equipment",
        transition: "1to2",
        isReliable: true,
        avgLagDays: "35",
        stddevLagDays: "14",
        sampleCount: 7,
      },
    ]);
    // pool.query: sector_rs_daily Phase 2 — 리더 + 팔로워 모두 Phase 2
    mockPoolQuery.mockResolvedValueOnce({
      rows: [
        { entity_name: "Semiconductors" },
        { entity_name: "Semiconductor Equipment" },
      ],
    });
    // pool.query: industry_rs_daily Phase 2 — 없음
    mockPoolQuery.mockResolvedValueOnce({ rows: [] });

    const result = formatLeadingSectorsForPrompt("2026-03-08");

    return result.then((value) => {
      expect(value).toBe("");
    });
  });
});

describe("constants", () => {
  it("MIN_SAMPLE은 5이다", () => {
    expect(MIN_SAMPLE).toBe(5);
  });

  it("LAG_SEARCH_WINDOW_DAYS는 180이다", () => {
    expect(LAG_SEARCH_WINDOW_DAYS).toBe(180);
  });
});
