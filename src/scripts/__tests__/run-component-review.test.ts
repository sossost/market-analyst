/**
 * 컴포넌트 리뷰 check 함수 단위 테스트.
 *
 * DB 접속 없이 순수 함수(check*)만 테스트한다.
 */

import { describe, it, expect } from "vitest";
import {
  checkEtlAuto,
  checkDetectionLag,
  checkThesisHitRate,
  checkReports,
  checkCorporateAnalyst,
  checkNarrativeChains,
} from "../run-component-review.js";
import type {
  ComponentKpiEtlRow,
  ComponentKpiNarrativeChainsRow,
  ComponentKpiCorporateAnalystRow,
  WeeklyQaDetectionLagRow,
} from "@/db/repositories/index.js";

// ─── checkEtlAuto ───────────────────────────────────────────

describe("checkEtlAuto", () => {
  const baseRow: ComponentKpiEtlRow = {
    new_count_7d: 5,
    total_active_etl: 80,
    featured_count: 8,
    featured_rate: 10.0,
    phase2_transition_7d: 30,
    registration_rate: 16.7,
  };

  it("new_count_7d가 0이면 ALERT + 이슈 1건 반환", () => {
    const result = checkEtlAuto({ ...baseRow, new_count_7d: 0 });

    expect(result.status).toBe("ALERT");
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].title).toContain("etl_auto");
    expect(result.issues[0].labels).toContain("P1: high");
  });

  it("new_count_7d가 0이고 phase2_transition_7d도 0이면 시장 원인 힌트 포함", () => {
    const result = checkEtlAuto({ ...baseRow, new_count_7d: 0, phase2_transition_7d: 0 });

    expect(result.status).toBe("ALERT");
    expect(result.issues[0].body).toContain("시장 원인");
  });

  it("new_count_7d가 0이고 phase2_transition_7d > 0이면 ETL 원인 힌트 포함", () => {
    const result = checkEtlAuto({ ...baseRow, new_count_7d: 0, phase2_transition_7d: 15 });

    expect(result.status).toBe("ALERT");
    expect(result.issues[0].body).toContain("ETL 로직 원인");
  });

  it("new_count_7d가 1 이상이면 OK + 이슈 없음", () => {
    const result = checkEtlAuto({ ...baseRow, new_count_7d: 5 });

    expect(result.status).toBe("OK");
    expect(result.issues).toHaveLength(0);
  });

  it("new_count_7d가 정확히 0일 때만 ALERT (0 === 0)", () => {
    expect(checkEtlAuto({ ...baseRow, new_count_7d: 0 }).status).toBe("ALERT");
    expect(checkEtlAuto({ ...baseRow, new_count_7d: 1 }).status).toBe("OK");
  });
});

// ─── checkDetectionLag ──────────────────────────────────────

describe("checkDetectionLag", () => {
  const makeRow = (source: string, cnt: number, avg_lag: number, catchup_cnt = 0): WeeklyQaDetectionLagRow => ({
    source,
    cnt,
    avg_lag,
    median_lag: avg_lag,
    early_cnt: 0,
    normal_cnt: 0,
    late_cnt: cnt,
    catchup_cnt,
  });

  it("가중평균 > 10이고 총 cnt >= 5이면 ALERT", () => {
    const result = checkDetectionLag([makeRow("etl_auto", 5, 11)]);

    expect(result.status).toBe("ALERT");
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].title).toContain("detection_lag");
    expect(result.issues[0].labels).toContain("P2: medium");
  });

  it("총 cnt < 5이면 샘플 부족 → OK", () => {
    const result = checkDetectionLag([makeRow("etl_auto", 3, 15)]);

    expect(result.status).toBe("OK");
    expect(result.issues).toHaveLength(0);
  });

  it("가중평균 <= 10이면 OK", () => {
    const result = checkDetectionLag([makeRow("etl_auto", 10, 9)]);

    expect(result.status).toBe("OK");
    expect(result.issues).toHaveLength(0);
  });

  it("복수 source의 가중평균을 올바르게 계산한다", () => {
    const rows = [
      makeRow("etl_auto", 8, 8),
      makeRow("agent", 4, 11.5),
    ];
    // (8*8 + 4*11.5) / 12 = (64 + 46) / 12 = 110/12 ≈ 9.17 → OK
    const result = checkDetectionLag(rows);
    expect(result.status).toBe("OK");
  });

  it("가중평균이 정확히 10.0이면 OK (boundary)", () => {
    const result = checkDetectionLag([makeRow("etl_auto", 10, 10)]);
    expect(result.status).toBe("OK");
  });

  it("빈 배열이면 OK (샘플 0건)", () => {
    const result = checkDetectionLag([]);

    expect(result.status).toBe("OK");
    expect(result.issues).toHaveLength(0);
  });

  it("ALERT 시 source별 테이블이 본문에 포함된다", () => {
    const result = checkDetectionLag([makeRow("etl_auto", 10, 15)]);

    expect(result.issues[0].body).toContain("etl_auto");
    expect(result.issues[0].body).toContain("source별 상세");
  });

  it("catch-up 건(>30일)은 KPI 판정에 영향을 주지 않는다", () => {
    // 유효 포착 5건 avg 8 → OK, catch-up 800건은 제외
    const result = checkDetectionLag([makeRow("etl_auto", 5, 8, 800)]);

    expect(result.status).toBe("OK");
    expect(result.issues).toHaveLength(0);
  });

  it("currentValue에 유효 건수와 catch-up 건수가 모두 표시된다", () => {
    const result = checkDetectionLag([makeRow("etl_auto", 10, 5, 50)]);

    expect(result.currentValue).toContain("유효=10");
    expect(result.currentValue).toContain("catch-up=50");
  });

  it("ALERT 시 이슈 본문에 catch-up 건수가 표시된다", () => {
    const result = checkDetectionLag([makeRow("etl_auto", 10, 15, 100)]);

    expect(result.status).toBe("ALERT");
    expect(result.issues[0].body).toContain("catch-up 제외: 100건");
  });
});

// ─── checkThesisHitRate ─────────────────────────────────────

describe("checkThesisHitRate", () => {
  const makeRow = (category: string, confirmed: number, invalidated: number, active = 0) => ({
    category,
    confirmed,
    invalidated,
    active,
  });

  it("n >= 20이고 hit_rate < 40%이면 ALERT", () => {
    // confirmed=8, invalidated=14 → n=22, hit_rate = 8/22 ≈ 36.4%
    const result = checkThesisHitRate([makeRow("sector_rotation", 8, 14)]);

    expect(result.status).toBe("ALERT");
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].title).toContain("sector_rotation");
    expect(result.issues[0].labels).toContain("P2: medium");
  });

  it("n < 20이면 통계적 유의성 없음 → OK", () => {
    // confirmed=8, invalidated=10 → n=18 < 20
    const result = checkThesisHitRate([makeRow("sector_rotation", 8, 10)]);

    expect(result.status).toBe("OK");
    expect(result.issues).toHaveLength(0);
  });

  it("n >= 20이고 hit_rate >= 40%이면 OK", () => {
    // confirmed=10, invalidated=15 → n=25, hit_rate = 40%
    const result = checkThesisHitRate([makeRow("sector_rotation", 10, 15)]);

    expect(result.status).toBe("OK");
  });

  it("여러 카테고리 중 이탈 카테고리만 이슈 생성", () => {
    const rows = [
      makeRow("sector_rotation", 8, 14), // ALERT: n=22, hit_rate≈36%
      makeRow("macro_trend", 12, 10),    // OK: n=22, hit_rate≈55%
    ];
    const result = checkThesisHitRate(rows);

    expect(result.status).toBe("ALERT");
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].title).toContain("sector_rotation");
  });

  it("빈 배열이면 OK", () => {
    const result = checkThesisHitRate([]);

    expect(result.status).toBe("OK");
    expect(result.issues).toHaveLength(0);
  });

  it("정확히 n=20일 때 이탈 조건 판단 — hit_rate < 40% → ALERT", () => {
    // confirmed=7, invalidated=13 → n=20, hit_rate=35%
    const result = checkThesisHitRate([makeRow("catalyst", 7, 13)]);

    expect(result.status).toBe("ALERT");
  });

  it("정확히 hit_rate = 40%이면 OK (boundary)", () => {
    // confirmed=8, invalidated=12 → n=20, hit_rate=40%
    const result = checkThesisHitRate([makeRow("catalyst", 8, 12)]);

    expect(result.status).toBe("OK");
  });
});

// ─── checkReports ───────────────────────────────────────────

describe("checkReports", () => {
  const now = new Date("2026-04-20T06:00:00Z");

  const makeReport = (type: string, daysAgo: number): { report_date: string; type: string } => {
    const d = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);
    return { report_date: d.toISOString().split("T")[0], type };
  };

  it("일간 리포트 7일 내 3건 이상 + 주간 리포트 14일 내 1건 이상이면 [OK, OK]", () => {
    const rows = [
      makeReport("daily", 1),
      makeReport("daily", 2),
      makeReport("daily", 3),
      makeReport("weekly", 7),
    ];
    const [dailyResult, weeklyResult] = checkReports(rows, now);

    expect(dailyResult.status).toBe("OK");
    expect(weeklyResult.status).toBe("OK");
  });

  it("일간 리포트 7일 내 3건 미만이면 일간 결과 ALERT", () => {
    const rows = [
      makeReport("daily", 1),
      makeReport("daily", 2),
      makeReport("weekly", 7),
    ];
    const [dailyResult] = checkReports(rows, now);

    expect(dailyResult.status).toBe("ALERT");
    expect(dailyResult.issues[0].title).toContain("일간");
    expect(dailyResult.issues[0].labels).toContain("P1: high");
  });

  it("주간 리포트 14일 내 1건 이상이면 주간 결과 OK", () => {
    const rows = [
      makeReport("daily", 1),
      makeReport("daily", 2),
      makeReport("daily", 3),
      makeReport("weekly", 7),
    ];
    const [, weeklyResult] = checkReports(rows, now);

    expect(weeklyResult.status).toBe("OK");
  });

  it("주간 리포트 14일 내 0건이면 주간 결과 ALERT", () => {
    const rows = [
      makeReport("daily", 1),
      makeReport("daily", 2),
      makeReport("daily", 3),
    ];
    const [, weeklyResult] = checkReports(rows, now);

    expect(weeklyResult.status).toBe("ALERT");
    expect(weeklyResult.issues[0].title).toContain("주간");
  });

  it("일간/주간 모두 이탈이면 각 결과가 ALERT + 이슈 각 1건", () => {
    const rows: { report_date: string; type: string }[] = [];
    const [dailyResult, weeklyResult] = checkReports(rows, now);

    expect(dailyResult.status).toBe("ALERT");
    expect(dailyResult.issues).toHaveLength(1);
    expect(weeklyResult.status).toBe("ALERT");
    expect(weeklyResult.issues).toHaveLength(1);
  });

  it("checkReports는 항상 2개 결과를 반환한다 (일간, 주간 순서)", () => {
    const results = checkReports([], now);

    expect(results).toHaveLength(2);
    expect(results[0].name).toBe("일간 리포트");
    expect(results[1].name).toBe("주간 리포트");
  });
});

// ─── checkCorporateAnalyst ──────────────────────────────────

describe("checkCorporateAnalyst", () => {
  const baseRow: ComponentKpiCorporateAnalystRow = {
    total_portfolio_active: 5,
    covered_count: 3,
    coverage_rate: 60.0,
  };

  it("featured >= 3이고 coverage_rate < 50이면 ALERT", () => {
    const result = checkCorporateAnalyst({ ...baseRow, coverage_rate: 33, covered_count: 1 });

    expect(result.status).toBe("ALERT");
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].title).toContain("기업 분석");
    expect(result.issues[0].labels).toContain("P2: medium");
  });

  it("featured < 3이면 판단 의미 없음 → OK", () => {
    const result = checkCorporateAnalyst({ total_portfolio_active: 2, covered_count: 0, coverage_rate: 0 });

    expect(result.status).toBe("OK");
    expect(result.issues).toHaveLength(0);
  });

  it("coverage_rate >= 50이면 OK", () => {
    const result = checkCorporateAnalyst(baseRow);

    expect(result.status).toBe("OK");
    expect(result.issues).toHaveLength(0);
  });

  it("coverage_rate가 null이면 ALERT (featured >= 3)", () => {
    const result = checkCorporateAnalyst({ ...baseRow, coverage_rate: null });

    expect(result.status).toBe("ALERT");
  });

  it("정확히 coverage_rate = 50이면 OK (boundary)", () => {
    const result = checkCorporateAnalyst({ ...baseRow, coverage_rate: 50, covered_count: 3 });

    expect(result.status).toBe("OK");
  });

  it("ALERT 시 이슈 제목에 비율 포함", () => {
    const result = checkCorporateAnalyst({ total_portfolio_active: 4, covered_count: 1, coverage_rate: 25 });

    expect(result.issues[0].title).toContain("25%");
  });
});

// ─── checkNarrativeChains ───────────────────────────────────

describe("checkNarrativeChains", () => {
  const baseData: ComponentKpiNarrativeChainsRow = {
    active_chain_count: 3,
    total_beneficiary_tickers: 20,
    phase2_beneficiary_count: 8,
    phase2_beneficiary_rate: 40.0,
    thesis_aligned_count: 5,
    thesis_aligned_rate: 25.0,
  };

  const now = new Date("2026-04-20T06:00:00Z");

  it("active_chain_count === 0이면 ALERT (조건 A)", () => {
    const result = checkNarrativeChains({ ...baseData, active_chain_count: 0 }, "2026-04-19", now);

    expect(result.status).toBe("ALERT");
    expect(result.issues.some((i) => i.title.includes("활성 체인 0건"))).toBe(true);
  });

  it("latest_identified_at이 7일 초과이면 ALERT (조건 B)", () => {
    const eightDaysAgo = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString();
    const result = checkNarrativeChains(baseData, eightDaysAgo, now);

    expect(result.status).toBe("ALERT");
    expect(result.issues.some((i) => i.title.includes("미갱신"))).toBe(true);
  });

  it("active_chain_count > 0이고 freshness <= 7일이면 OK", () => {
    const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const result = checkNarrativeChains(baseData, threeDaysAgo, now);

    expect(result.status).toBe("OK");
    expect(result.issues).toHaveLength(0);
  });

  it("조건 A + B 모두 이탈이면 이슈 2건", () => {
    const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString();
    const result = checkNarrativeChains({ ...baseData, active_chain_count: 0 }, tenDaysAgo, now);

    expect(result.status).toBe("ALERT");
    expect(result.issues).toHaveLength(2);
  });

  it("latest_identified_at이 null이면 freshness 체크 스킵", () => {
    const result = checkNarrativeChains(baseData, null, now);

    expect(result.status).toBe("OK");
    expect(result.issues).toHaveLength(0);
  });

  it("조건 A 이슈에 component-reviewer 레이블 포함", () => {
    const result = checkNarrativeChains({ ...baseData, active_chain_count: 0 }, null, now);

    expect(result.issues[0].labels).toContain("component-reviewer");
    expect(result.issues[0].labels).toContain("P2: medium");
  });

  it("정확히 7일 경과이면 OK (임계치 초과 = strictly >)", () => {
    const exactlySevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const result = checkNarrativeChains(baseData, exactlySevenDaysAgo, now);

    expect(result.status).toBe("OK");
  });
});
