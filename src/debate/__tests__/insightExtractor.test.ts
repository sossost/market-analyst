import { describe, it, expect } from "vitest";
import { extractDailyInsight } from "../insightExtractor.js";

// ────────────────────────────────────────────
// Fixtures
// ────────────────────────────────────────────

function makeReportWith핵심발견(content: string): string {
  return `## 시황 브리핑

### 1. 핵심 한 줄
GPU 병목 해소 전환 신호 포착 — 다음 제약은 HBM으로 이동 중.

### 2. 시장 데이터
- SPY: 580.12 (-0.8%)
- VIX: 18.5

### 3. 핵심 발견 + 병목 상태
${content}

### 4. 기회: 주도섹터/주도주
반도체 섹터 Phase 2 전환 중.`;
}

function makeReportWith핵심한줄Only(headline: string): string {
  return `## 시황 브리핑

### 1. 핵심 한 줄
${headline}

### 2. 시장 데이터
- SPY: 580.12 (-0.8%)`;
}

// ────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────

describe("extractDailyInsight", () => {
  describe("빈 입력 처리", () => {
    it("빈 문자열이면 빈 문자열 반환", () => {
      expect(extractDailyInsight("")).toBe("");
    });

    it("공백만 있는 문자열이면 빈 문자열 반환", () => {
      expect(extractDailyInsight("   \n  ")).toBe("");
    });
  });

  describe("핵심 발견 섹션 우선 추출", () => {
    it("### 3. 핵심 발견 섹션을 추출한다", () => {
      const findings = "AI 인프라 수요 가속 — HBM 공급 병목이 심화되고 있다.";
      const report = makeReportWith핵심발견(findings);

      const result = extractDailyInsight(report);
      expect(result).toContain(findings);
    });

    it("### 3. 핵심 발견 내용이 여러 줄이어도 전부 포함한다", () => {
      const multiLine = `AI 인프라 수요 가속.\n\n- NVDA Phase 2 진입\n- HBM 공급 타이트`;
      const report = makeReportWith핵심발견(multiLine);

      const result = extractDailyInsight(report);
      expect(result).toContain("NVDA Phase 2 진입");
      expect(result).toContain("HBM 공급 타이트");
    });

    it("섹션 헤더 텍스트 자체는 포함하지 않는다", () => {
      const report = makeReportWith핵심발견("핵심 발견 내용입니다.");

      const result = extractDailyInsight(report);
      expect(result).not.toContain("### 3. 핵심 발견");
    });
  });

  describe("핵심 한 줄 섹션 fallback", () => {
    it("핵심 발견 섹션이 없으면 핵심 한 줄을 사용한다", () => {
      const headline = "GPU 병목 해소 신호 — 다음 제약은 HBM.";
      const report = makeReportWith핵심한줄Only(headline);

      const result = extractDailyInsight(report);
      expect(result).toContain(headline);
    });

    it("핵심 한 줄 섹션 헤더 자체는 포함하지 않는다", () => {
      const report = makeReportWith핵심한줄Only("주요 발견.");

      const result = extractDailyInsight(report);
      expect(result).not.toContain("### 1. 핵심 한 줄");
    });
  });

  describe("최종 fallback (첫 300자)", () => {
    it("구조화된 섹션이 없으면 첫 300자를 반환한다", () => {
      const plainReport = "이것은 구조가 없는 리포트입니다. 시장이 하락했습니다.";

      const result = extractDailyInsight(plainReport);
      expect(result.length).toBeGreaterThan(0);
      expect(result).toContain("시장이 하락했습니다");
    });

    it("300자 초과 시 ... 로 끝난다", () => {
      const longReport = "A".repeat(400);

      const result = extractDailyInsight(longReport);
      expect(result).toHaveLength(303); // 300 + "..."
      expect(result.endsWith("...")).toBe(true);
    });

    it("정확히 마침표로 끝나면 ... 를 붙이지 않는다", () => {
      const shortReport = "짧은 리포트입니다.";

      const result = extractDailyInsight(shortReport);
      expect(result).toBe("짧은 리포트입니다.");
    });
  });

  describe("섹션 추출 경계 조건", () => {
    it("핵심 발견 섹션이 비어있으면 핵심 한 줄로 fallback한다", () => {
      const report = `### 1. 핵심 한 줄
주목할 발견.

### 3. 핵심 발견 + 병목 상태

### 4. 기회
섹터 분석.`;

      const result = extractDailyInsight(report);
      expect(result).toContain("주목할 발견");
    });

    it("두 섹션이 모두 비어있으면 첫 300자 fallback으로 처리한다", () => {
      const report = `### 1. 핵심 한 줄

### 3. 핵심 발견 + 병목 상태

### 4. 기회
섹터 분석 내용이 있습니다.`;

      const result = extractDailyInsight(report);
      // fallback이 실행되어 빈 문자열이 아니어야 함
      expect(result.length).toBeGreaterThan(0);
    });
  });
});
