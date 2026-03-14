import { describe, it, expect } from "vitest";
import { runStockReportQA } from "../stockReportQA.js";

// ─── 테스트 픽스처 ────────────────────────────────────────────────────

/** 5개 섹션 + 리스크 언급 + 정상 마진 표기를 갖춘 정상 리포트 */
function buildValidReport(): string {
  return [
    "# [NVDA] 종목 심층 분석",
    "",
    "> 분석일: 2025-01-01 | 펀더멘탈 등급: **S** | 데이터 품질: ✅ 검증 통과",
    "",
    "## 1. 기술적 현황",
    "",
    "- Phase 2, RS 92",
    "- 52주 고점 대비 -3.2%",
    "",
    "## 2. 펀더멘탈 분석",
    "",
    "| 기준 | 판정 | 상세 |",
    "|------|------|------|",
    "| EPS 성장 (필수) | ✅ | EPS YoY +120% |",
    "| 이익률 확대 (가점) | ✅ | 이익률 확대 확인 |",
    "",
    "## 3. 분기별 실적",
    "",
    "| 분기 | EPS | 매출 | 순이익 | 이익률 |",
    "|------|-----|------|--------|--------|",
    "| 2024Q3 | $0.74 | $30.0B | $19.3B | 64.3% |",
    "| 2024Q2 | $0.68 | $28.0B | $16.6B | 59.3% |",
    "",
    "## 4. 펀더멘탈 애널리스트 분석",
    "",
    "AI 인프라 수요가 지속 확대되며 매출 고성장 중.",
    "다만 리스크 요인으로 경쟁 심화와 설비투자 부담이 있으며 확인 필요.",
    "",
    "## 5. 종합 판단",
    "",
    "**Phase 2 (RS 92) + 펀더멘탈 S등급**",
    "",
    "최우선 관찰 대상.",
  ].join("\n");
}

// ─── 테스트 ───────────────────────────────────────────────────────────

describe("runStockReportQA", () => {
  describe("정상 리포트", () => {
    it("5개 섹션 + 리스크 언급 + 정상 마진 → passed: true", () => {
      const report = buildValidReport();
      const result = runStockReportQA("NVDA", report);

      expect(result.passed).toBe(true);
      expect(result.issues).toHaveLength(0);
      expect(result.symbol).toBe("NVDA");
    });
  });

  describe("MARGIN_RAW_DECIMAL", () => {
    it("이익률 열에 | 0.235 | 형태 소수점 표기 → 이슈 검출", () => {
      const report = buildValidReport().replace(
        "| 2024Q3 | $0.74 | $30.0B | $19.3B | 64.3% |",
        "| 2024Q3 | $0.74 | $30.0B | $19.3B | 0.235 |",
      );
      const result = runStockReportQA("NVDA", report);

      const issue = result.issues.find((i) => i.checkId === "MARGIN_RAW_DECIMAL");
      expect(issue).toBeDefined();
      expect(issue?.severity).toBe("HIGH");
    });

    it("이익률이 퍼센트(64.3%)로 정상 표기 → MARGIN_RAW_DECIMAL 없음", () => {
      const report = buildValidReport();
      const result = runStockReportQA("NVDA", report);

      const issue = result.issues.find((i) => i.checkId === "MARGIN_RAW_DECIMAL");
      expect(issue).toBeUndefined();
    });

    it("EPS 열의 $0.74 형태 소수점은 오탐하지 않음", () => {
      // EPS는 테이블 셀에서 `| $0.74 |` 형태 — 앞에 `$`가 있어 패턴 불일치
      const report = buildValidReport();
      const result = runStockReportQA("NVDA", report);

      const issue = result.issues.find((i) => i.checkId === "MARGIN_RAW_DECIMAL");
      expect(issue).toBeUndefined();
    });
  });

  describe("SECTION_MISSING", () => {
    it("## 4. 섹션 누락 → SECTION_MISSING 검출", () => {
      const report = buildValidReport().replace(
        "## 4. 펀더멘탈 애널리스트 분석",
        "## X. 펀더멘탈 애널리스트 분석",
      );
      const result = runStockReportQA("NVDA", report);

      const issue = result.issues.find((i) => i.checkId === "SECTION_MISSING");
      expect(issue).toBeDefined();
      expect(issue?.severity).toBe("HIGH");
      expect(issue?.description).toContain("## 4.");
    });

    it("5개 섹션 모두 존재 → SECTION_MISSING 없음", () => {
      const report = buildValidReport();
      const result = runStockReportQA("NVDA", report);

      const issue = result.issues.find((i) => i.checkId === "SECTION_MISSING");
      expect(issue).toBeUndefined();
    });
  });

  describe("NO_RISK_MENTION", () => {
    it("리스크 관련 키워드가 전혀 없음 → NO_RISK_MENTION 검출", () => {
      const report = [
        "# [NVDA] 종목 심층 분석",
        "",
        "## 1. 기술적 현황",
        "",
        "- Phase 2, RS 92",
        "",
        "## 2. 펀더멘탈 분석",
        "",
        "| 분기 | EPS |",
        "|------|-----|",
        "",
        "## 3. 분기별 실적",
        "",
        "| 분기 | EPS | 매출 | 순이익 | 이익률 |",
        "|------|-----|------|--------|--------|",
        "| 2024Q3 | $0.74 | $30.0B | $19.3B | 64.3% |",
        "",
        "## 4. 펀더멘탈 애널리스트 분석",
        "",
        "AI 인프라 수요가 지속 확대되며 매출 고성장 중.",
        "",
        "## 5. 종합 판단",
        "",
        "최우선 관찰 대상.",
      ].join("\n");

      const result = runStockReportQA("NVDA", report);

      const issue = result.issues.find((i) => i.checkId === "NO_RISK_MENTION");
      expect(issue).toBeDefined();
      expect(issue?.severity).toBe("HIGH");
    });

    it("'리스크' 키워드 존재 → NO_RISK_MENTION 없음", () => {
      const report = buildValidReport(); // 이미 "리스크" 포함
      const result = runStockReportQA("NVDA", report);

      const issue = result.issues.find((i) => i.checkId === "NO_RISK_MENTION");
      expect(issue).toBeUndefined();
    });

    it("'주의' 키워드만 있어도 → NO_RISK_MENTION 없음", () => {
      const report = buildValidReport().replace(
        "다만 리스크 요인으로",
        "다만 주의해야 할 요인으로",
      );
      const result = runStockReportQA("NVDA", report);

      const issue = result.issues.find((i) => i.checkId === "NO_RISK_MENTION");
      expect(issue).toBeUndefined();
    });
  });

  describe("EPS_INCONSISTENCY", () => {
    it("분기별 실적 테이블 데이터 행 없음 → EPS_INCONSISTENCY 검출", () => {
      const report = [
        "# [NVDA] 종목 심층 분석",
        "",
        "## 1. 기술적 현황",
        "",
        "- Phase 2, RS 92",
        "",
        "## 2. 펀더멘탈 분석",
        "",
        "## 3. 분기별 실적",
        "",
        "| 분기 | EPS | 매출 | 순이익 | 이익률 |",
        "|------|-----|------|--------|--------|",
        // 데이터 행 없음
        "",
        "## 4. 펀더멘탈 애널리스트 분석",
        "",
        "분석 내용. 리스크 존재.",
        "",
        "## 5. 종합 판단",
        "",
        "종합 판단.",
      ].join("\n");

      const result = runStockReportQA("NVDA", report);

      const issue = result.issues.find((i) => i.checkId === "EPS_INCONSISTENCY");
      expect(issue).toBeDefined();
      expect(issue?.severity).toBe("HIGH");
    });

    it("분기별 실적 테이블에 데이터 행 존재 → EPS_INCONSISTENCY 없음", () => {
      const report = buildValidReport();
      const result = runStockReportQA("NVDA", report);

      const issue = result.issues.find((i) => i.checkId === "EPS_INCONSISTENCY");
      expect(issue).toBeUndefined();
    });
  });

  describe("PHASE2_DROP_MISMATCH", () => {
    it("Phase 2 언급 200자 내 '급락' 키워드 → PHASE2_DROP_MISMATCH 검출", () => {
      const report = buildValidReport().replace(
        "AI 인프라 수요가 지속 확대되며 매출 고성장 중.",
        "Phase 2이나 당일 급락 — 모멘텀 훼손 여부 확인 필요.",
      );
      const result = runStockReportQA("NVDA", report);

      const issue = result.issues.find((i) => i.checkId === "PHASE2_DROP_MISMATCH");
      expect(issue).toBeDefined();
      expect(issue?.severity).toBe("MEDIUM");
    });

    it("Phase 2 언급 200자 이후 '약세' 키워드 → PHASE2_DROP_MISMATCH 없음", () => {
      // 200자 이후에 약세 키워드 배치
      const padding = "X".repeat(250);
      const report = buildValidReport().replace(
        "AI 인프라 수요가 지속 확대되며 매출 고성장 중.",
        `${padding}약세 경고.`,
      );
      const result = runStockReportQA("NVDA", report);

      const issue = result.issues.find((i) => i.checkId === "PHASE2_DROP_MISMATCH");
      expect(issue).toBeUndefined();
    });

    it("Phase 2 언급 없는 리포트 → PHASE2_DROP_MISMATCH 없음", () => {
      const report = buildValidReport()
        .replace(/Phase 2/g, "Phase 1");
      const result = runStockReportQA("NVDA", report);

      const issue = result.issues.find((i) => i.checkId === "PHASE2_DROP_MISMATCH");
      expect(issue).toBeUndefined();
    });
  });

  describe("복합 이슈", () => {
    it("여러 이슈 동시 존재 → 모두 검출, passed: false", () => {
      const report = [
        "# [BAD] 종목 심층 분석",
        "",
        "## 1. 기술적 현황",
        "",
        "- Phase 2, RS 50",
        "",
        // 섹션 2,3,4,5 누락
        // 리스크 키워드 없음
        // 분기 테이블 없음
      ].join("\n");

      const result = runStockReportQA("BAD", report);

      expect(result.passed).toBe(false);
      expect(result.issues.length).toBeGreaterThan(0);

      const sectionIssue = result.issues.find((i) => i.checkId === "SECTION_MISSING");
      const riskIssue = result.issues.find((i) => i.checkId === "NO_RISK_MENTION");
      expect(sectionIssue).toBeDefined();
      expect(riskIssue).toBeDefined();
    });
  });
});
