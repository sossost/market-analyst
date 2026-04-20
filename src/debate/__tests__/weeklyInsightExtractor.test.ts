import { describe, it, expect } from "vitest";
import {
  extractBottleneckStatuses,
  extractLeadingSectorNames,
  extractWarningTargets,
  aggregateWeeklyDebateInsights,
  formatWeeklyDebateForPrompt,
} from "../insightExtractor.js";
import type { WeeklyDebateSummary } from "../insightExtractor.js";

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeReportWithBottleneck(bottleneckSection: string): string {
  return `## 시황 브리핑

### 1. 핵심 한 줄
GPU 병목 해소 전환 신호 포착.

### 2. 시장 데이터
- SPY: 580.12 (-0.8%)

### 3. 핵심 발견 + 병목 상태
${bottleneckSection}

### 4. 기회: 주도섹터/주도주
반도체 섹터.`;
}

function makeReportWithLeadingSectors(sectorSection: string): string {
  return `## 시황 브리핑

### 1. 핵심 한 줄
테크 주도 상승.

### 2. 시장 데이터
- SPY: 590.00 (+1.0%)

### 3. 핵심 발견 + 병목 상태
AI 인프라 수요 지속.

### 4. 기회: 주도섹터/주도주
${sectorSection}

### 5. 경고: 과열/위험 종목
특이사항 없음.`;
}

function makeReportWithWarnings(warningSection: string): string {
  return `## 시황 브리핑

### 1. 핵심 한 줄
과열 경계.

### 2. 시장 데이터
- SPY: 570.00 (-1.5%)

### 3. 핵심 발견 + 병목 상태
기술적 반등.

### 4. 기회: 주도섹터/주도주
반도체.

### 5. 경고: 과열/위험 종목
${warningSection}

### 6. 분석가 이견
없음.`;
}

function makeFullReport(date: string, bottlenecks: string, sectors: string, warnings: string): string {
  return `## 시황 브리핑

### 1. 핵심 한 줄
${date} 시황 요약.

### 2. 시장 데이터
- SPY: 580.12 (-0.8%)

### 3. 핵심 발견 + 병목 상태
${bottlenecks}

### 4. 기회: 주도섹터/주도주
${sectors}

### 5. 경고: 과열/위험 종목
${warnings}

### 6. 분석가 이견
없음.`;
}

// ─── extractBottleneckStatuses ────────────────────────────────────────────────

describe("extractBottleneckStatuses", () => {
  it("표준 병목 상태를 추출한다", () => {
    const report = makeReportWithBottleneck(
      `발견 1: HBM 공급 병목
- **HBM 공급**: ACTIVE
- **GPU 재고**: RESOLVING`,
    );
    const result = extractBottleneckStatuses(report);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ name: "HBM 공급", status: "ACTIVE" });
    expect(result[1]).toEqual({ name: "GPU 재고", status: "RESOLVING" });
  });

  it("대소문자 혼합을 처리한다", () => {
    const report = makeReportWithBottleneck("메모리 공급: active");
    const result = extractBottleneckStatuses(report);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ name: "메모리 공급", status: "ACTIVE" });
  });

  it("RESOLVED와 OVERSUPPLY 상태를 추출한다", () => {
    const report = makeReportWithBottleneck(
      `칩 공급: RESOLVED
원자재: OVERSUPPLY`,
    );
    const result = extractBottleneckStatuses(report);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ name: "칩 공급", status: "RESOLVED" });
    expect(result[1]).toEqual({ name: "원자재", status: "OVERSUPPLY" });
  });

  it("병목 상태가 없는 보고서에서 빈 배열 반환", () => {
    const report = makeReportWithBottleneck("특이사항 없음.");
    const result = extractBottleneckStatuses(report);
    expect(result).toEqual([]);
  });

  it("빈 보고서에서 빈 배열 반환", () => {
    expect(extractBottleneckStatuses("")).toEqual([]);
  });

  it("em-dash 구분자를 처리한다", () => {
    const report = makeReportWithBottleneck("데이터센터 전력 — ACTIVE");
    const result = extractBottleneckStatuses(report);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ name: "데이터센터 전력", status: "ACTIVE" });
  });
});

// ─── extractLeadingSectorNames ───────────────────────────────────────────────

describe("extractLeadingSectorNames", () => {
  it("테이블 형식에서 섹터 이름을 추출한다", () => {
    const report = makeReportWithLeadingSectors(
      `| 섹터/종목 | 근거 | 상태 |
|----------|------|------|
| Technology | AI 인프라 | 상승 초입 |
| Semiconductors | HBM 수요 | 가속 |`,
    );
    const result = extractLeadingSectorNames(report);
    expect(result).toContain("Technology");
    expect(result).toContain("Semiconductors");
  });

  it("볼드 텍스트에서 섹터 이름을 추출한다", () => {
    const report = makeReportWithLeadingSectors(
      `**Energy** 섹터가 주도하고 있다.
**NVDA**는 핵심 수혜주.`,
    );
    const result = extractLeadingSectorNames(report);
    expect(result).toContain("Energy");
    expect(result).toContain("NVDA");
  });

  it("중복 이름을 제거한다", () => {
    const report = makeReportWithLeadingSectors(
      `**Technology**는 강세.
| Technology | AI | 상승 |`,
    );
    const result = extractLeadingSectorNames(report);
    const techCount = result.filter((n) => n === "Technology").length;
    expect(techCount).toBe(1);
  });

  it("빈 보고서에서 빈 배열 반환", () => {
    expect(extractLeadingSectorNames("")).toEqual([]);
  });

  it("섹션 4가 없는 보고서에서 빈 배열 반환", () => {
    const report = `### 1. 핵심 한 줄
테스트.

### 3. 핵심 발견
테스트.`;
    expect(extractLeadingSectorNames(report)).toEqual([]);
  });
});

// ─── extractWarningTargets ────────────────────────────────────────────────────

describe("extractWarningTargets", () => {
  it("볼드 텍스트에서 경고 대상을 추출한다", () => {
    const report = makeReportWithWarnings(
      `**TSLA** — RS 급락, 과열 해소 중
**Solar 섹터** — 정책 리스크`,
    );
    const result = extractWarningTargets(report);
    expect(result).toContain("TSLA");
    expect(result).toContain("Solar 섹터");
  });

  it("리스트 패턴에서 경고 대상을 추출한다", () => {
    const report = makeReportWithWarnings(
      `- AAPL: 고점 피로감 경계
- 에너지 섹터: 유가 급락 리스크`,
    );
    const result = extractWarningTargets(report);
    expect(result).toContain("AAPL");
    expect(result).toContain("에너지 섹터");
  });

  it("빈 보고서에서 빈 배열 반환", () => {
    expect(extractWarningTargets("")).toEqual([]);
  });

  it("중복 대상을 제거한다", () => {
    const report = makeReportWithWarnings(
      `**TSLA** — 과열
- TSLA: 또 과열`,
    );
    const result = extractWarningTargets(report);
    const tslaCount = result.filter((n) => n === "TSLA").length;
    expect(tslaCount).toBe(1);
  });
});

// ─── aggregateWeeklyDebateInsights ────────────────────────────────────────────

describe("aggregateWeeklyDebateInsights", () => {
  it("빈 세션 배열이면 null 반환", () => {
    expect(aggregateWeeklyDebateInsights([])).toBeNull();
  });

  it("5세션에서 병목 추이를 추출한다", () => {
    const sessions = [
      { date: "2026-04-14", synthesisReport: makeFullReport("Mon", "HBM 공급: ACTIVE", "", "") },
      { date: "2026-04-15", synthesisReport: makeFullReport("Tue", "HBM 공급: ACTIVE", "", "") },
      { date: "2026-04-16", synthesisReport: makeFullReport("Wed", "HBM 공급: RESOLVING", "", "") },
      { date: "2026-04-17", synthesisReport: makeFullReport("Thu", "HBM 공급: RESOLVING", "", "") },
      { date: "2026-04-18", synthesisReport: makeFullReport("Fri", "HBM 공급: RESOLVING", "", "") },
    ];

    const result = aggregateWeeklyDebateInsights(sessions);
    expect(result).not.toBeNull();
    expect(result!.sessionCount).toBe(5);
    expect(result!.bottleneckTransitions).toHaveLength(1);
    expect(result!.bottleneckTransitions[0]).toEqual({
      name: "HBM 공급",
      initialStatus: "ACTIVE",
      finalStatus: "RESOLVING",
      changed: true,
    });
  });

  it("변화 없는 병목은 changed=false", () => {
    const sessions = [
      { date: "2026-04-14", synthesisReport: makeFullReport("Mon", "GPU 재고: ACTIVE", "", "") },
      { date: "2026-04-18", synthesisReport: makeFullReport("Fri", "GPU 재고: ACTIVE", "", "") },
    ];

    const result = aggregateWeeklyDebateInsights(sessions);
    expect(result!.bottleneckTransitions[0].changed).toBe(false);
  });

  it("60% 이상 언급된 섹터만 합의로 인정한다", () => {
    const sessions = [
      { date: "2026-04-14", synthesisReport: makeFullReport("Mon", "", "**Technology** 강세", "") },
      { date: "2026-04-15", synthesisReport: makeFullReport("Tue", "", "**Technology** 지속 강세", "") },
      { date: "2026-04-16", synthesisReport: makeFullReport("Wed", "", "**Technology** 가속", "") },
      { date: "2026-04-17", synthesisReport: makeFullReport("Thu", "", "**Energy** 반등", "") },
      { date: "2026-04-18", synthesisReport: makeFullReport("Fri", "", "**Technology** 유지", "") },
    ];

    const result = aggregateWeeklyDebateInsights(sessions);
    expect(result!.leadingSectors.length).toBeGreaterThanOrEqual(1);
    const techSector = result!.leadingSectors.find((s) => s.name === "Technology");
    expect(techSector).toBeDefined();
    expect(techSector!.mentionCount).toBe(4);

    // Energy는 1/5 = 20% 이므로 합의 미달
    const energySector = result!.leadingSectors.find((s) => s.name === "Energy");
    expect(energySector).toBeUndefined();
  });

  it("2회 이상 반복 경고된 대상만 포함한다", () => {
    const sessions = [
      { date: "2026-04-14", synthesisReport: makeFullReport("Mon", "", "", "**TSLA** — 과열") },
      { date: "2026-04-15", synthesisReport: makeFullReport("Tue", "", "", "**TSLA** — 과열 지속") },
      { date: "2026-04-16", synthesisReport: makeFullReport("Wed", "", "", "**AAPL** — 고점 피로") },
      { date: "2026-04-17", synthesisReport: makeFullReport("Thu", "", "", "특이사항 없음") },
      { date: "2026-04-18", synthesisReport: makeFullReport("Fri", "", "", "**TSLA** — 과열 경계") },
    ];

    const result = aggregateWeeklyDebateInsights(sessions);
    expect(result!.warnings.length).toBe(1);
    expect(result!.warnings[0].target).toBe("TSLA");
    expect(result!.warnings[0].warningCount).toBe(3);
  });

  it("단일 세션도 처리한다 (휴일 주)", () => {
    const sessions = [
      {
        date: "2026-04-14",
        synthesisReport: makeFullReport(
          "Mon",
          "HBM 공급: ACTIVE",
          "**Technology** 강세",
          "**TSLA** — 과열",
        ),
      },
    ];

    const result = aggregateWeeklyDebateInsights(sessions);
    expect(result).not.toBeNull();
    expect(result!.sessionCount).toBe(1);
    // 60% of 1 = ceil(0.6) = 1, so 1/1 qualifies
    expect(result!.leadingSectors).toHaveLength(1);
    // Min warning count is 2, so 1/1 does NOT qualify
    expect(result!.warnings).toHaveLength(0);
  });

  it("구조화 추출 불가 세션은 빈 결과로 처리 (graceful)", () => {
    const sessions = [
      { date: "2026-04-14", synthesisReport: "구조화되지 않은 자유 텍스트 보고서입니다." },
      { date: "2026-04-15", synthesisReport: "또 다른 자유 텍스트." },
    ];

    const result = aggregateWeeklyDebateInsights(sessions);
    expect(result).not.toBeNull();
    expect(result!.sessionCount).toBe(2);
    expect(result!.bottleneckTransitions).toHaveLength(0);
    expect(result!.leadingSectors).toHaveLength(0);
    expect(result!.warnings).toHaveLength(0);
  });
});

// ─── formatWeeklyDebateForPrompt ──────────────────────────────────────────────

describe("formatWeeklyDebateForPrompt", () => {
  it("종합 결과를 프롬프트 텍스트로 포매팅한다", () => {
    const summary: WeeklyDebateSummary = {
      bottleneckTransitions: [
        { name: "HBM 공급", initialStatus: "ACTIVE", finalStatus: "RESOLVING", changed: true },
      ],
      leadingSectors: [{ name: "Technology", mentionCount: 4, totalDays: 5 }],
      warnings: [{ target: "TSLA", warningCount: 3, totalDays: 5 }],
      sessionCount: 5,
    };

    const result = formatWeeklyDebateForPrompt(summary);
    expect(result).toContain("5세션");
    expect(result).toContain("HBM 공급");
    expect(result).toContain("ACTIVE → RESOLVING");
    expect(result).toContain("Technology");
    expect(result).toContain("4/5일 언급");
    expect(result).toContain("TSLA");
    expect(result).toContain("3/5일 경고");
  });

  it("빈 종합 결과도 처리한다", () => {
    const summary: WeeklyDebateSummary = {
      bottleneckTransitions: [],
      leadingSectors: [],
      warnings: [],
      sessionCount: 3,
    };

    const result = formatWeeklyDebateForPrompt(summary);
    expect(result).toContain("3세션");
    expect(result).toContain("구조화 추출 가능한 데이터가 없습니다");
  });

  it("3,000자를 초과하면 잘린다", () => {
    const longNameSectors = Array.from({ length: 100 }, (_, i) => ({
      name: `매우긴섹터이름${"A".repeat(30)}_${i}`,
      mentionCount: 5,
      totalDays: 5,
    }));

    const summary: WeeklyDebateSummary = {
      bottleneckTransitions: [],
      leadingSectors: longNameSectors,
      warnings: [],
      sessionCount: 5,
    };

    const result = formatWeeklyDebateForPrompt(summary);
    expect(result.length).toBeLessThanOrEqual(3_005); // 3000 + "\n..."
    expect(result).toContain("...");
  });
});
