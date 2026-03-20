import { describe, expect, it } from "vitest";
import { sanitizePhase2Ratios, validateReport, MIN_DAILY_MD_LENGTH } from "../reportValidator";

/** 500자 이상 마크다운을 만들기 위한 패딩 생성 헬퍼 */
function padToMinLength(base: string): string {
  const padding = " ".repeat(Math.max(0, MIN_DAILY_MD_LENGTH - base.length));
  return base + padding;
}

describe("validateReport", () => {
  // -------------------------------------------------------------------------
  // A. 리스크 키워드 존재 여부
  // -------------------------------------------------------------------------

  it("리스크 키워드가 포함된 정상 리포트 → isValid: true, warnings/errors 비어있음", () => {
    const result = validateReport({
      markdown:
        "반도체 섹터가 상승세를 보이고 있으나, 밸류에이션 과열 리스크와 하락 가능성에 주의가 필요합니다.",
    });

    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it("리스크 키워드가 전혀 없는 리포트 → errors에 경고 메시지 포함", () => {
    const result = validateReport({
      markdown:
        "반도체 섹터가 강세를 보이며 신고가를 돌파했습니다. 성장 전망이 매우 긍정적입니다.",
    });

    expect(result.isValid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("리스크 관련 키워드가 전혀 없습니다");
  });

  it("bull-bias 90% 리포트 → warnings에 bias 경고 포함", () => {
    // bull 9개 키워드, bear 1개 키워드 → 90%
    const result = validateReport({
      markdown:
        "상승 급등 돌파 신고가 강세 긍정 호재 성장 개선 — 다만 약간의 리스크 존재.",
    });

    expect(result.isValid).toBe(true);
    expect(result.warnings.length).toBeGreaterThanOrEqual(1);
    expect(result.warnings.some((w) => w.includes("Bull-bias"))).toBe(true);
    expect(result.warnings.some((w) => w.includes("90%"))).toBe(true);
  });

  it("bull-bias 70% 이하면 bias 경고 없음", () => {
    // bull 2개, bear 1개 → 66.7% (threshold 미초과이므로 경고 없음)
    const result = validateReport({
      markdown: "상승 돌파 — 하락 위험도 있다.",
    });

    const biasWarning = result.warnings.find((w) => w.includes("Bull-bias"));
    expect(biasWarning).toBeUndefined();
  });

  it("bull-bias 정확히 70%이면 bias 경고 없음 (경계값)", () => {
    // bull 7개, bear 3개 → 70% (threshold와 동일, 초과 아님 → 경고 없음)
    const result = validateReport({
      markdown: "상승 급등 돌파 신고가 강세 긍정 호재 — 리스크 주의 경고.",
    });

    const biasWarning = result.warnings.find((w) => w.includes("Bull-bias"));
    expect(biasWarning).toBeUndefined();
  });

  it("bull-bias 80% 리포트 → 70% 임계값 초과이므로 warnings에 bias 경고 포함", () => {
    // bull 4개(상승, 돌파, 강세, 성장), bear 1개(리스크) → 80%
    const result = validateReport({
      markdown: "상승 돌파 강세 성장 — 리스크 있다.",
    });

    const biasWarning = result.warnings.find((w) => w.includes("Bull-bias"));
    expect(biasWarning).toBeDefined();
    expect(biasWarning).toContain("80%");
  });

  // -------------------------------------------------------------------------
  // B. 섹터-종목 정합성
  // -------------------------------------------------------------------------

  it("섹터 완전 불일치 → warnings에 불일치 경고 포함", () => {
    const result = validateReport({
      markdown: "시장 분석 리포트. 리스크 주의 필요.",
      leadingSectors: ["반도체", "AI"],
      recommendations: [
        { symbol: "XOM", sector: "에너지" },
        { symbol: "JPM", sector: "금융" },
      ],
    });

    expect(result.warnings.some((w) => w.includes("섹터-종목 불일치"))).toBe(true);
  });

  it("섹터 부분 일치 → 불일치 경고 없음", () => {
    const result = validateReport({
      markdown: "시장 분석 리포트. 리스크 주의 필요.",
      leadingSectors: ["반도체", "AI"],
      recommendations: [
        { symbol: "NVDA", sector: "반도체" },
        { symbol: "XOM", sector: "에너지" },
      ],
    });

    const sectorWarning = result.warnings.find((w) =>
      w.includes("섹터-종목 불일치"),
    );
    expect(sectorWarning).toBeUndefined();
  });

  it("leadingSectors만 있고 recommendations 없으면 섹터 체크 스킵", () => {
    const result = validateReport({
      markdown: "시장 분석 리포트. 리스크 주의 필요.",
      leadingSectors: ["반도체"],
    });

    const sectorWarning = result.warnings.find((w) =>
      w.includes("섹터-종목 불일치"),
    );
    expect(sectorWarning).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // C. 기준 미달 종목 태깅
  // -------------------------------------------------------------------------

  it("Phase 1 종목이 recommendations에 포함되면 errors에 감지 메시지 포함", () => {
    const result = validateReport({
      markdown: "시장 분석 리포트. 리스크 주의 필요.",
      recommendations: [
        { symbol: "PBFS", rsScore: 65, phase: 1 },
        { symbol: "NVDA", rsScore: 85, phase: 2 },
      ],
    });

    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.includes("Phase 1 종목 추천 감지"))).toBe(true);
    expect(result.errors.some((e) => e.includes("PBFS"))).toBe(true);
    expect(result.errors.some((e) => e.includes("Phase 1"))).toBe(true);
    // NVDA는 Phase 2이므로 errors에 포함되지 않아야 함
    expect(result.errors.some((e) => e.includes("NVDA"))).toBe(false);
  });

  it("Phase 1 종목이 없고 RS만 미달인 종목은 warnings에만 포함 (errors 아님)", () => {
    const result = validateReport({
      markdown: "시장 분석 리포트. 리스크 주의 필요.",
      recommendations: [
        { symbol: "AAPL", rsScore: 45, phase: 3 },
        { symbol: "NVDA", rsScore: 85, phase: 2 },
      ],
    });

    // Phase 1이 없으므로 isValid는 에러 기준으로만 판단
    expect(result.errors.some((e) => e.includes("Phase 1 종목 추천 감지"))).toBe(false);
    // RS 미달은 warnings
    expect(result.warnings.some((w) => w.includes("RS 기준 미달 종목"))).toBe(true);
    expect(result.warnings.some((w) => w.includes("AAPL"))).toBe(true);
    expect(result.warnings.some((w) => w.includes("RS 45"))).toBe(true);
  });

  it("Phase 1 + RS 미달이 동시인 종목은 Phase 우선으로 errors에 포함", () => {
    const result = validateReport({
      markdown: "시장 분석 리포트. 리스크 주의 필요.",
      recommendations: [
        { symbol: "AVGO", rsScore: 56, phase: 1 },
        { symbol: "AAPL", rsScore: 45, phase: 3 },
        { symbol: "NVDA", rsScore: 85, phase: 2 },
      ],
    });

    expect(result.isValid).toBe(false);
    // AVGO는 Phase 1이므로 errors
    expect(result.errors.some((e) => e.includes("AVGO"))).toBe(true);
    expect(result.errors.some((e) => e.includes("Phase 1 종목 추천 감지"))).toBe(true);
    // AAPL은 Phase 3 + RS 미달 → warnings
    expect(result.warnings.some((w) => w.includes("AAPL"))).toBe(true);
    expect(result.warnings.some((w) => w.includes("RS 45"))).toBe(true);
    // NVDA는 기준 충족 → 어디에도 포함되지 않음
    const allMessages = [...result.errors, ...result.warnings];
    expect(allMessages.some((m) => m.includes("NVDA"))).toBe(false);
  });

  it("빈 recommendations → 기준 미달 체크 스킵", () => {
    const result = validateReport({
      markdown: "시장 분석 리포트. 리스크 주의 필요.",
      recommendations: [],
    });

    expect(result.errors.some((e) => e.includes("Phase 1 종목 추천 감지"))).toBe(false);
    expect(result.warnings.some((w) => w.includes("RS 기준 미달 종목"))).toBe(false);
  });

  it("recommendations 없으면 기준 미달 체크 스킵", () => {
    const result = validateReport({
      markdown: "시장 분석 리포트. 리스크 주의 필요.",
    });

    expect(result.errors.some((e) => e.includes("Phase 1 종목 추천 감지"))).toBe(false);
    expect(result.warnings.some((w) => w.includes("RS 기준 미달 종목"))).toBe(false);
  });

  it("rsScore와 phase가 모두 없는 종목은 기준 미달에 포함되지 않음", () => {
    const result = validateReport({
      markdown: "시장 분석 리포트. 리스크 주의 필요.",
      recommendations: [{ symbol: "TSLA" }],
    });

    expect(result.errors.some((e) => e.includes("Phase 1 종목 추천 감지"))).toBe(false);
    expect(result.warnings.some((w) => w.includes("RS 기준 미달 종목"))).toBe(false);
  });

  // -------------------------------------------------------------------------
  // D. Phase 2 비율 범위 검증 (이중 변환 방어)
  // -------------------------------------------------------------------------

  it("Phase 2 비율 3520% → errors에 이중 변환 경고 포함", () => {
    const result = validateReport({
      markdown:
        "Phase 2: 3520% (▲5.2%) 리스크 주의 필요. 시장 하락 가능성.",
    });

    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.includes("Phase 2 비율 이상값"))).toBe(
      true,
    );
    expect(result.errors.some((e) => e.includes("3520"))).toBe(true);
  });

  it("Phase 2: 35.2% (정상 범위) → Phase 2 비율 에러 없음", () => {
    const result = validateReport({
      markdown:
        "Phase 2: 35.2% (▲1.5%) 리스크 주의 필요. 시장 하락 위험.",
    });

    const phase2Error = result.errors.find((e) =>
      e.includes("Phase 2 비율 이상값"),
    );
    expect(phase2Error).toBeUndefined();
  });

  it("Phase 2: 100% (경계값) → Phase 2 비율 에러 없음", () => {
    const result = validateReport({
      markdown:
        "Phase 2: 100% 리스크 주의 필요.",
    });

    const phase2Error = result.errors.find((e) =>
      e.includes("Phase 2 비율 이상값"),
    );
    expect(phase2Error).toBeUndefined();
  });

  it("Phase 2 비율 150% → errors에 이상값 포함", () => {
    const result = validateReport({
      markdown:
        "Phase 2: 150% 리스크 주의 필요.",
    });

    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.includes("150"))).toBe(true);
  });

  it("여러 Phase 2 비율 패턴이 있으면 각각 검증", () => {
    const result = validateReport({
      markdown:
        "Phase 2: 35.2% 정상. Phase 2 추이: 3520% 비정상. 리스크 주의.",
    });

    expect(result.isValid).toBe(false);
    const phase2Errors = result.errors.filter((e) =>
      e.includes("Phase 2 비율 이상값"),
    );
    expect(phase2Errors).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // E. 일간 리포트 필수 섹션 검증
  // -------------------------------------------------------------------------

  it("validateReport를 연속 두 번 호출해도 각각 독립적으로 동작한다", () => {
    const first = validateReport({
      markdown: "Phase 2: 3520% 리스크 주의.",
    });
    expect(first.errors.some((e) => e.includes("Phase 2 비율 이상값"))).toBe(
      true,
    );

    const second = validateReport({
      markdown: "Phase 2: 35.2% 리스크 주의.",
    });
    const phase2Error = second.errors.find((e) =>
      e.includes("Phase 2 비율 이상값"),
    );
    expect(phase2Error).toBeUndefined();
  });

  it("일간 리포트에 필수 섹션 모두 포함 → 섹션 누락 경고 없음", () => {
    const result = validateReport({
      markdown: padToMinLength(
        "## 시장 온도 근거\n시장 분석.\n## 섹터 RS 랭킹\n표.\n## 시장 흐름\n종합 전망. 리스크 주의.",
      ),
      reportType: "daily",
    });

    const sectionError = result.errors.find((e) =>
      e.includes("필수 섹션 누락"),
    );
    expect(sectionError).toBeUndefined();
  });

  it("일간 리포트에 '시장 온도' 누락 → errors에 누락 경고", () => {
    const result = validateReport({
      markdown: padToMinLength(
        "## 섹터 RS 랭킹\n표.\n## 시장 흐름\n종합 전망. 리스크 주의.",
      ),
      reportType: "daily",
    });

    const sectionError = result.errors.find((e) =>
      e.includes("필수 섹션 누락"),
    );
    expect(sectionError).toBeDefined();
    expect(sectionError).toContain("시장 온도 근거");
  });

  it("일간 리포트에 '섹터 RS'와 '시장 흐름' 누락 → errors에 두 섹션 모두 표시", () => {
    const result = validateReport({
      markdown: padToMinLength(
        "## 시장 온도 분석\n데이터. 리스크 주의.",
      ),
      reportType: "daily",
    });

    const sectionError = result.errors.find((e) =>
      e.includes("필수 섹션 누락"),
    );
    expect(sectionError).toBeDefined();
    expect(sectionError).toContain("섹터 RS 랭킹 표");
    expect(sectionError).toContain("시장 흐름 및 종합 전망");
  });

  it("일간 리포트 500자 미만이면 섹션 검사 스킵", () => {
    const shortMarkdown = "## 섹터 RS 랭킹\n표.\n리스크 주의.";
    expect(shortMarkdown.length).toBeLessThan(MIN_DAILY_MD_LENGTH);

    const result = validateReport({
      markdown: shortMarkdown,
      reportType: "daily",
    });

    const sectionError = result.errors.find((e) =>
      e.includes("필수 섹션 누락"),
    );
    expect(sectionError).toBeUndefined();
  });

  it("'섹터별 요약' 누락 → warnings에 권장 섹션 경고", () => {
    const result = validateReport({
      markdown: padToMinLength(
        "## 시장 온도 근거\n분석.\n## 섹터 RS 랭킹\n표.\n## 시장 흐름\n전망. 리스크 주의.",
      ),
      reportType: "daily",
    });

    const sectionWarning = result.warnings.find((w) =>
      w.includes("권장 섹션 누락"),
    );
    expect(sectionWarning).toBeDefined();
    expect(sectionWarning).toContain("섹터별 요약");
  });

  it("권장 섹션 모두 포함 시 권장 섹션 경고 없음", () => {
    const result = validateReport({
      markdown: padToMinLength(
        "## 시장 온도 근거\n분석.\n## 섹터 RS 랭킹\n표.\n## 시장 흐름\n전망.\n## 섹터별 요약\n요약.\n## 전일 대비 변화 요약\n변화. 리스크 주의.",
      ),
      reportType: "daily",
    });

    const sectionWarning = result.warnings.find((w) =>
      w.includes("권장 섹션 누락"),
    );
    expect(sectionWarning).toBeUndefined();
  });

  it("weekly 리포트에서는 일간 필수 섹션 검증을 실행하지 않음", () => {
    const result = validateReport({
      markdown: "주간 리포트. 리스크 주의.",
      reportType: "weekly",
    });

    const sectionError = result.errors.find((e) =>
      e.includes("필수 섹션 누락"),
    );
    expect(sectionError).toBeUndefined();
  });

  it("reportType 미지정 시 일간 필수 섹션 검증을 실행하지 않음", () => {
    const result = validateReport({
      markdown: "일반 리포트. 리스크 주의.",
    });

    const sectionError = result.errors.find((e) =>
      e.includes("필수 섹션 누락"),
    );
    expect(sectionError).toBeUndefined();
  });

  it("일간 리포트에 '전일 대비' 없으면 권장 섹션 경고 포함", () => {
    const result = validateReport({
      markdown: padToMinLength(
        "## 시장 온도 근거\n분석.\n## 섹터 RS 랭킹\n표.\n## 시장 흐름\n전망.\n## 섹터별 요약\n요약. 리스크 주의.",
      ),
      reportType: "daily",
    });

    const sectionWarning = result.warnings.find((w) =>
      w.includes("권장 섹션 누락"),
    );
    expect(sectionWarning).toBeDefined();
    expect(sectionWarning).toContain("전일 대비 변화 요약");
  });

  it("일간 리포트에 '전일 대비' 포함 시 해당 권장 섹션 경고 없음", () => {
    const result = validateReport({
      markdown: padToMinLength(
        "## 시장 온도 근거\n분석.\n## 섹터 RS 랭킹\n표.\n## 시장 흐름\n전망.\n## 섹터별 요약\n요약.\n## 전일 대비 변화 요약\n변화 내용. 리스크 주의.",
      ),
      reportType: "daily",
    });

    const sectionWarnings = result.warnings.filter((w) =>
      w.includes("권장 섹션 누락"),
    );
    const hasDailyChangeWarning = sectionWarnings.some((w) =>
      w.includes("전일 대비 변화 요약"),
    );
    expect(hasDailyChangeWarning).toBe(false);
  });

  // -------------------------------------------------------------------------
  // F. Phase 분류 ↔ 서술 불일치 감지
  // -------------------------------------------------------------------------

  it("Phase 2와 약세 서술이 같은 줄에 등장하면 warnings에 모순 경고", () => {
    const result = validateReport({
      markdown:
        "SLDB Phase 2 — 바이오테크 약세 시작. 리스크 주의.",
      reportType: "daily",
    });

    const conflictWarning = result.warnings.find((w) =>
      w.includes("Phase 2 분류 ↔ 약세 서술 모순"),
    );
    expect(conflictWarning).toBeDefined();
    expect(conflictWarning).toContain("1건");
  });

  it("Phase 2와 급락 서술이 같은 줄에 등장하면 errors에 모순 경고 (심각)", () => {
    const result = validateReport({
      markdown:
        "COOK Phase 2 — 급락 경고. 리스크 주의.",
      reportType: "daily",
    });

    expect(result.isValid).toBe(false);
    const conflictError = result.errors.find((e) =>
      e.includes("Phase 2 ↔ 급락 서술 모순"),
    );
    expect(conflictError).toBeDefined();
    expect(conflictError).toContain("1건");
  });

  it("Phase 2와 약세 서술이 다른 줄에 있으면 경고 없음", () => {
    const result = validateReport({
      markdown:
        "SLDB Phase 2 — 바이오테크 강세 흐름.\n다음 주 약세 가능성도 배제 못 함. 리스크 주의.",
      reportType: "daily",
    });

    const conflictWarning = result.warnings.find((w) =>
      w.includes("Phase 2 분류 ↔ 약세 서술 모순"),
    );
    expect(conflictWarning).toBeUndefined();
  });

  it("여러 Phase 2 + 약세(비급락) 패턴이 있으면 건수를 정확히 표시", () => {
    const result = validateReport({
      markdown:
        "SLDB Phase 2 — 약세 시작.\nNVDA Phase 2 — 하락세 지속. 리스크 주의.",
      reportType: "daily",
    });

    const conflictWarning = result.warnings.find((w) =>
      w.includes("Phase 2 분류 ↔ 약세 서술 모순"),
    );
    expect(conflictWarning).toBeDefined();
    expect(conflictWarning).toContain("2건");
  });

  it("Phase 2 + 급락/약세 혼합 시 급락은 errors, 약세는 warnings로 분리", () => {
    const result = validateReport({
      markdown:
        "COOK Phase 2 — 급락 경고.\nSLDB Phase 2 — 약세 시작. 리스크 주의.",
      reportType: "daily",
    });

    expect(result.errors.some((e) => e.includes("Phase 2 ↔ 급락 서술 모순"))).toBe(true);
    expect(result.warnings.some((w) => w.includes("Phase 2 분류 ↔ 약세 서술 모순"))).toBe(true);
  });

  it("Phase 2 + 모멘텀 훼손 서술 → warnings에 모순 경고", () => {
    const result = validateReport({
      markdown:
        "TYGO Phase 2 — 모멘텀 훼손 가능성. 리스크 주의.",
      reportType: "daily",
    });

    const conflictWarning = result.warnings.find((w) =>
      w.includes("Phase 2 분류 ↔ 약세 서술 모순"),
    );
    expect(conflictWarning).toBeDefined();
  });

  it("Phase 2 + 추세 이탈 서술 → warnings에 모순 경고", () => {
    const result = validateReport({
      markdown:
        "EDSA Phase 2 — 추세 이탈 우려. 리스크 주의.",
      reportType: "daily",
    });

    const conflictWarning = result.warnings.find((w) =>
      w.includes("Phase 2 분류 ↔ 약세 서술 모순"),
    );
    expect(conflictWarning).toBeDefined();
  });

  it("weekly 리포트에서는 Phase 분류 일관성 검사를 실행하지 않음", () => {
    const result = validateReport({
      markdown:
        "SLDB Phase 2 — 바이오테크 약세 시작. 리스크 주의.",
      reportType: "weekly",
    });

    const conflictWarning = result.warnings.find((w) =>
      w.includes("Phase 2 분류 ↔ 약세 서술 모순"),
    );
    expect(conflictWarning).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // G. 마크다운 텍스트 기반 Phase 1 추천 감지 (recommendations 없이도 동작)
  // -------------------------------------------------------------------------

  it("[기준 미달] 태그가 마크다운에 포함되면 errors 발생", () => {
    const result = validateReport({
      markdown: "PBFS [기준 미달] — Phase 1 종목. 리스크 주의.",
    });

    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.includes("[기준 미달]"))).toBe(true);
  });

  it("[기준 미달] 태그 없고 Phase 1 추천 문맥이 없으면 에러 없음", () => {
    const result = validateReport({
      markdown: "NVDA Phase 2 — 반도체 강세 지속. 리스크 주의.",
    });

    expect(result.errors.some((e) => e.includes("기준 미달"))).toBe(false);
    expect(result.errors.some((e) => e.includes("Phase 1 종목 추천 문맥"))).toBe(false);
  });

  it("Phase 1 + 추천 문맥이 같은 줄에 있으면 errors 발생", () => {
    const result = validateReport({
      markdown: "PBFS Phase 1 종목으로 추천 합니다. 리스크 주의.",
    });

    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.includes("Phase 1 종목 추천 문맥"))).toBe(true);
  });

  it("Phase 1 언급이 있지만 추천 문맥이 아니면 에러 없음", () => {
    const result = validateReport({
      markdown: "Phase 1 종목은 관찰 단계입니다. 리스크 주의.",
    });

    expect(result.errors.some((e) => e.includes("Phase 1 종목 추천 문맥"))).toBe(false);
  });

  // -------------------------------------------------------------------------
  // H. 주도 섹터 연속 동일 시 유지 사유 서술 검증
  // -------------------------------------------------------------------------

  it("전일 대비 섹션에 섹터 동일 언급 + 사유 없음 → warnings 발생", () => {
    const result = validateReport({
      markdown: padToMinLength(
        "## 시장 온도 근거\n분석.\n## 섹터 RS 랭킹\n표.\n## 시장 흐름\n전망.\n## 전일 대비 변화 요약\n주도 섹터 전일과 동일. 리스크 주의.",
      ),
      reportType: "daily",
    });

    expect(result.warnings.some((w) => w.includes("유지 사유가 서술되지 않았습니다"))).toBe(true);
  });

  it("전일 대비 섹션에 섹터 동일 + 사유 키워드 있음 → warnings 없음", () => {
    const result = validateReport({
      markdown: padToMinLength(
        "## 시장 온도 근거\n분석.\n## 섹터 RS 랭킹\n표.\n## 시장 흐름\n전망.\n## 전일 대비 변화 요약\n주도 섹터 전일과 동일 — WTI 상승 지속 때문. 리스크 주의.",
      ),
      reportType: "daily",
    });

    expect(result.warnings.some((w) => w.includes("유지 사유가 서술되지 않았습니다"))).toBe(false);
  });

  it("전일 대비 섹션이 없으면 섹터 동일 검사 스킵", () => {
    const result = validateReport({
      markdown: padToMinLength(
        "## 시장 온도 근거\n분석.\n## 섹터 RS 랭킹\n표.\n## 시장 흐름\n전망. 주도 섹터 동일. 리스크 주의.",
      ),
      reportType: "daily",
    });

    expect(result.warnings.some((w) => w.includes("유지 사유가 서술되지 않았습니다"))).toBe(false);
  });

  // -------------------------------------------------------------------------
  // I. 종목 방향 반전 감지
  // -------------------------------------------------------------------------

  it("같은 종목이 강세/약세 섹션에 동시 등장 → warnings 발생", () => {
    const result = validateReport({
      markdown: padToMinLength(
        "## 시장 온도 근거\n분석.\n## 섹터 RS 랭킹\n표.\n## 시장 흐름\n전망.\n⭐ 강세 특이종목\nCOOK (Phase 2, RS 73) +8.5%\n⚠️ 약세 경고\nCOOK Phase 2 급락 -7%. 리스크 주의.",
      ),
      reportType: "daily",
    });

    expect(result.warnings.some((w) => w.includes("방향 반전 감지"))).toBe(true);
    expect(result.warnings.some((w) => w.includes("COOK"))).toBe(true);
  });

  it("강세/약세에 겹치는 종목 없으면 방향 반전 경고 없음", () => {
    const result = validateReport({
      markdown: padToMinLength(
        "## 시장 온도 근거\n분석.\n## 섹터 RS 랭킹\n표.\n## 시장 흐름\n전망.\n⭐ 강세 특이종목\nNVDA (Phase 2, RS 90) +3.2%\n⚠️ 약세 경고\nCOOK Phase 2 급락 -7%. 리스크 주의.",
      ),
      reportType: "daily",
    });

    expect(result.warnings.some((w) => w.includes("방향 반전 감지"))).toBe(false);
  });

  it("weekly 리포트에서는 방향 반전 검사를 실행하지 않음", () => {
    const result = validateReport({
      markdown:
        "⭐ 강세 특이종목\nCOOK +8.5%\n⚠️ 약세 경고\nCOOK -7%. 리스크 주의.",
      reportType: "weekly",
    });

    expect(result.warnings.some((w) => w.includes("방향 반전 감지"))).toBe(false);
  });

  // -------------------------------------------------------------------------
  // D-2. Phase 2 비율 콜론 없는 패턴 검증
  // -------------------------------------------------------------------------

  it("Phase 2 비율 2160.0% (콜론 없음) → errors에 이중 변환 경고", () => {
    const result = validateReport({
      markdown:
        "Phase 2 비율 2160.0% 리스크 주의.",
    });

    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.includes("Phase 2 비율 이상값"))).toBe(true);
    expect(result.errors.some((e) => e.includes("2160"))).toBe(true);
  });

  it("Phase 2 종목 비율 1500% (콜론 없음) → errors에 이중 변환 경고", () => {
    const result = validateReport({
      markdown:
        "Phase 2 종목 비율 1500% 리스크 주의.",
    });

    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.includes("Phase 2 비율 이상값"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// J. Phase 2 비율 이중 변환 자동 교정 (sanitizePhase2Ratios)
// ---------------------------------------------------------------------------

describe("sanitizePhase2Ratios", () => {
  it("2110% → 21.1% 자동 교정", () => {
    const input = "Phase 2: 2110% (▲5.2%) 리스크 주의.";
    const { text, corrections } = sanitizePhase2Ratios(input);

    expect(text).toBe("Phase 2: 21.1% (▲5.2%) 리스크 주의.");
    expect(corrections).toHaveLength(1);
    expect(corrections[0]).toBe("2110% → 21.1%");
  });

  it("2330.0% → 23.3% 자동 교정", () => {
    const input = "Phase 2: 2330.0% 리스크 주의.";
    const { text, corrections } = sanitizePhase2Ratios(input);

    expect(text).toBe("Phase 2: 23.3% 리스크 주의.");
    expect(corrections).toHaveLength(1);
  });

  it("3520% → 35.2% 자동 교정", () => {
    const input = "Phase 2 비율: 3520% 리스크 주의.";
    const { text, corrections } = sanitizePhase2Ratios(input);

    expect(text).toBe("Phase 2 비율: 35.2% 리스크 주의.");
    expect(corrections).toHaveLength(1);
  });

  it("정상 범위(35.2%)는 변경하지 않음", () => {
    const input = "Phase 2: 35.2% (▲1.5%) 리스크 주의.";
    const { text, corrections } = sanitizePhase2Ratios(input);

    expect(text).toBe(input);
    expect(corrections).toHaveLength(0);
  });

  it("경계값 100%는 변경하지 않음", () => {
    const input = "Phase 2: 100% 리스크 주의.";
    const { text, corrections } = sanitizePhase2Ratios(input);

    expect(text).toBe(input);
    expect(corrections).toHaveLength(0);
  });

  it("여러 이중 변환을 한꺼번에 교정", () => {
    const input = "Phase 2: 2110% 정상. Phase 2 추이: 3520% 비정상. 리스크 주의.";
    const { text, corrections } = sanitizePhase2Ratios(input);

    expect(text).toBe("Phase 2: 21.1% 정상. Phase 2 추이: 35.2% 비정상. 리스크 주의.");
    expect(corrections).toHaveLength(2);
  });

  it("10000% → 100.0% 자동 교정 (1.0 이중 변환)", () => {
    const input = "Phase 2: 10000% 리스크 주의.";
    const { text, corrections } = sanitizePhase2Ratios(input);

    expect(text).toBe("Phase 2: 100.0% 리스크 주의.");
    expect(corrections).toHaveLength(1);
  });

  it("Phase 2가 없는 텍스트는 변경하지 않음", () => {
    const input = "시장 분석: 상승 2110% 리스크 주의.";
    const { text, corrections } = sanitizePhase2Ratios(input);

    expect(text).toBe(input);
    expect(corrections).toHaveLength(0);
  });

  it("교정 후 validateReport를 통과함", () => {
    const input = "Phase 2: 2110% (▲5.2%) 리스크 주의. 시장 하락 위험.";
    const { text } = sanitizePhase2Ratios(input);
    const result = validateReport({ markdown: text });

    const phase2Error = result.errors.find((e) =>
      e.includes("Phase 2 비율 이상값"),
    );
    expect(phase2Error).toBeUndefined();
  });

  // 전일 비율 이중 변환 자동 교정
  it("(전일 2110%) → (전일 21.1%) 자동 교정", () => {
    const input = "Phase 2: 21.6% (전일 2110%) 리스크 주의.";
    const { text, corrections } = sanitizePhase2Ratios(input);

    expect(text).toBe("Phase 2: 21.6% (전일 21.1%) 리스크 주의.");
    expect(corrections).toHaveLength(1);
    expect(corrections[0]).toContain("전일");
  });

  it("Phase 2와 전일 모두 이중 변환이면 양쪽 다 교정", () => {
    const input = "Phase 2: 2160.0% (전일 2110.0%) 리스크 주의.";
    const { text, corrections } = sanitizePhase2Ratios(input);

    expect(text).toBe("Phase 2: 21.6% (전일 21.1%) 리스크 주의.");
    expect(corrections).toHaveLength(2);
  });

  it("(전일 35.2%) 정상 범위는 변경하지 않음", () => {
    const input = "Phase 2: 21.6% (전일 35.2%) 리스크 주의.";
    const { text, corrections } = sanitizePhase2Ratios(input);

    expect(text).toBe(input);
    expect(corrections).toHaveLength(0);
  });

  it("전일 비율 이상값 감지 (validateReport)", () => {
    const result = validateReport({
      markdown: "Phase 2: 21.6% (전일 2110%) 리스크 주의.",
    });

    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.includes("전일 비율 이상값"))).toBe(true);
  });

  it("Phase 2 비율 2160% (콜론 없음) → 21.6% 자동 교정", () => {
    const input = "Phase 2 비율 2160.0% 리스크 주의.";
    const { text, corrections } = sanitizePhase2Ratios(input);

    expect(text).toBe("Phase 2 비율 21.6% 리스크 주의.");
    expect(corrections).toHaveLength(1);
  });

  it("Phase 2 종목 비율 1500% (콜론 없음) → 15.0% 자동 교정", () => {
    const input = "Phase 2 종목 비율 1500% 리스크 주의.";
    const { text, corrections } = sanitizePhase2Ratios(input);

    expect(text).toBe("Phase 2 종목 비율 15.0% 리스크 주의.");
    expect(corrections).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// J-2. 역분할 의심 종목 감지 (checkReverseSplitSuspect)
// ---------------------------------------------------------------------------

describe("validateReport — 역분할 의심 종목 감지", () => {
  it("Phase 4→2 + pctFromLow52w 5000% → 역분할 의심 경고", () => {
    const result = validateReport({
      markdown: "시장 분석 리포트. 리스크 주의.",
      recommendations: [
        { symbol: "COOK", phase: 2, prevPhase: 4, pctFromLow52w: 5000, rsScore: 100 },
      ],
    });

    const warning = result.warnings.find(w => w.includes("역분할 의심") && w.includes("COOK") && w.includes("Phase 4→2"));
    expect(warning).toBeDefined();
    expect(warning).toContain("역분할 의심");
    expect(warning).toContain("COOK");
    expect(warning).toContain("Phase 4→2");
  });

  it("Phase 3→2 + pctFromLow52w 2000% → 역분할 의심 경고", () => {
    const result = validateReport({
      markdown: "시장 분석 리포트. 리스크 주의.",
      recommendations: [
        { symbol: "TEST", phase: 2, prevPhase: 3, pctFromLow52w: 2000, rsScore: 90 },
      ],
    });

    const warning = result.warnings.find(w => w.includes("역분할 의심") && w.includes("TEST"));
    expect(warning).toBeDefined();
    expect(warning).toContain("역분할 의심");
    expect(warning).toContain("TEST");
  });

  it("Phase 1→2 (정상 전환) → 역분할 의심 없음", () => {
    const result = validateReport({
      markdown: "시장 분석 리포트. 리스크 주의.",
      recommendations: [
        { symbol: "NVDA", phase: 2, prevPhase: 1, pctFromLow52w: 300, rsScore: 85 },
      ],
    });

    expect(result.warnings.some((w) => w.includes("역분할 의심"))).toBe(false);
  });

  it("Phase 4→2이지만 pctFromLow52w가 500% (임계값 이하) → 역분할 의심 없음", () => {
    const result = validateReport({
      markdown: "시장 분석 리포트. 리스크 주의.",
      recommendations: [
        { symbol: "ABC", phase: 2, prevPhase: 4, pctFromLow52w: 500, rsScore: 80 },
      ],
    });

    expect(result.warnings.some((w) => w.includes("역분할 의심"))).toBe(false);
  });

  it("prevPhase가 없는 종목은 역분할 검사 스킵", () => {
    const result = validateReport({
      markdown: "시장 분석 리포트. 리스크 주의.",
      recommendations: [
        { symbol: "XYZ", phase: 2, pctFromLow52w: 5000, rsScore: 95 },
      ],
    });

    expect(result.warnings.some((w) => w.includes("역분할 의심"))).toBe(false);
  });

  it("pctFromLow52w가 없는 종목은 역분할 검사 스킵", () => {
    const result = validateReport({
      markdown: "시장 분석 리포트. 리스크 주의.",
      recommendations: [
        { symbol: "XYZ", phase: 2, prevPhase: 4, rsScore: 95 },
      ],
    });

    expect(result.warnings.some((w) => w.includes("역분할 의심"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// K. 추천 종목별 리스크 언급 비율 검증 (checkPerRecRiskMention)
// ---------------------------------------------------------------------------

describe("validateReport — 추천 종목별 리스크 언급 비율", () => {
  it("3건 이상 추천 중 리스크 언급 0건 → 리스크 비율 경고", () => {
    const result = validateReport({
      markdown: padToMinLength(
        "## 시장 온도 근거\n시장 분석.\n## 섹터 RS 랭킹\n표.\n## 시장 흐름\n전망.\nOVID 강세 돌파.\n\n\nCOOK 상승 추세.\n\n\nSTRO 신고가.\n\n\n시장 전반적 리스크 존재하나 해당 종목들은 견조.",
      ),
      reportType: "daily",
      recommendations: [
        { symbol: "OVID", rsScore: 85, phase: 2 },
        { symbol: "COOK", rsScore: 73, phase: 2 },
        { symbol: "STRO", rsScore: 99, phase: 2 },
      ],
    });

    const warning = result.warnings.find(w => w.includes("리스크 언급 비율") && w.includes("0%"));
    expect(warning).toBeDefined();
    expect(warning).toContain("리스크 언급 비율");
    expect(warning).toContain("0%");
  });

  it("3건 추천 중 1건에 리스크 언급 (33%) → 경고 없음", () => {
    const result = validateReport({
      markdown: padToMinLength(
        "## 시장 온도 근거\n시장 분석.\n## 섹터 RS 랭킹\n표.\n## 시장 흐름\n전망.\nOVID 강세 돌파.\nCOOK 상승 추세.\nSTRO 급락 경고 — 변동성 주의. 리스크 주의.",
      ),
      reportType: "daily",
      recommendations: [
        { symbol: "OVID", rsScore: 85, phase: 2 },
        { symbol: "COOK", rsScore: 73, phase: 2 },
        { symbol: "STRO", rsScore: 99, phase: 2 },
      ],
    });

    expect(result.warnings.some((w) => w.includes("리스크 언급 비율"))).toBe(false);
  });

  it("추천 2건 미만이면 리스크 비율 검사 스킵", () => {
    const result = validateReport({
      markdown: padToMinLength(
        "## 시장 온도 근거\n시장 분석.\n## 섹터 RS 랭킹\n표.\n## 시장 흐름\n전망.\nOVID 강세 돌파. 리스크 주의.",
      ),
      reportType: "daily",
      recommendations: [
        { symbol: "OVID", rsScore: 85, phase: 2 },
      ],
    });

    expect(result.warnings.some((w) => w.includes("리스크 언급 비율"))).toBe(false);
  });

  it("weekly 리포트에서는 종목별 리스크 비율 검사 스킵", () => {
    const result = validateReport({
      markdown: "OVID 돌파.\nCOOK 상승.\nSTRO 신고가. 리스크 주의.",
      reportType: "weekly",
      recommendations: [
        { symbol: "OVID", rsScore: 85, phase: 2 },
        { symbol: "COOK", rsScore: 73, phase: 2 },
        { symbol: "STRO", rsScore: 99, phase: 2 },
      ],
    });

    expect(result.warnings.some((w) => w.includes("리스크 언급 비율"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// L. 극단적 거래량 과열 경고 누락 감지 (checkExtremeVolumeWithoutWarning)
// ---------------------------------------------------------------------------

describe("validateReport — 극단적 거래량 과열 경고 누락", () => {
  it("volRatio 13.7배 + 과열 경고 없음 → 경고 발생", () => {
    const result = validateReport({
      markdown: "OVID 강세 돌파 신고가.\n\n\n시장 전반적 리스크 존재.",
      recommendations: [
        { symbol: "OVID", rsScore: 85, phase: 2, volRatio: 13.7 },
      ],
    });

    const warning = result.warnings.find(w => w.includes("극단적 거래량") && w.includes("OVID") && w.includes("13.7배"));
    expect(warning).toBeDefined();
    expect(warning).toContain("극단적 거래량");
    expect(warning).toContain("OVID");
    expect(warning).toContain("13.7배");
  });

  it("volRatio 13.7배 + 과열 경고 있음 → 경고 없음", () => {
    const result = validateReport({
      markdown: "OVID 강세 돌파 — 거래량 급증 과열 주의. 리스크 주의.",
      recommendations: [
        { symbol: "OVID", rsScore: 85, phase: 2, volRatio: 13.7 },
      ],
    });

    expect(result.warnings.some((w) => w.includes("극단적 거래량"))).toBe(false);
  });

  it("volRatio 5배 (임계값 이하) → 경고 없음", () => {
    const result = validateReport({
      markdown: "OVID 강세 돌파. 리스크 주의.",
      recommendations: [
        { symbol: "OVID", rsScore: 85, phase: 2, volRatio: 5.0 },
      ],
    });

    expect(result.warnings.some((w) => w.includes("극단적 거래량"))).toBe(false);
  });

  it("volRatio 없는 종목은 거래량 검사 스킵", () => {
    const result = validateReport({
      markdown: "NVDA 강세 돌파. 리스크 주의.",
      recommendations: [
        { symbol: "NVDA", rsScore: 85, phase: 2 },
      ],
    });

    expect(result.warnings.some((w) => w.includes("극단적 거래량"))).toBe(false);
  });

  it("여러 극단적 거래량 종목 중 경고 있는 종목은 제외", () => {
    const result = validateReport({
      markdown: "OVID 강세 돌파 과열.\n\n\nSTRO 강세 신고가 상승.\n\n\n시장 전반적 리스크 존재.",
      recommendations: [
        { symbol: "OVID", rsScore: 85, phase: 2, volRatio: 13.7 },
        { symbol: "STRO", rsScore: 99, phase: 2, volRatio: 11.2 },
      ],
    });

    const warning = result.warnings.find(w => w.includes("극단적 거래량"));
    expect(warning).toBeDefined();
    expect(warning).toContain("STRO");
    expect(warning).not.toContain("OVID");
  });
});
