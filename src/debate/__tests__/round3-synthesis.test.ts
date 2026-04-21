import { describe, it, expect, vi } from "vitest";
import { formatFundamentalContext, buildSynthesisPrompt, formatRegimeContext, logConditionParsability } from "../round3-synthesis.js";
import { formatExistingThesesForSynthesis, DEDUP_LOOKBACK_DAYS } from "../thesisStore.js";
import type { MarketRegimeRow } from "../regimeStore.js";
import type { FundamentalScore } from "@/types/fundamental";
import type { RoundOutput, AgentPersona } from "@/types/debate";

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeScore(overrides: Partial<FundamentalScore> = {}): FundamentalScore {
  return {
    symbol: "NVDA",
    grade: "A",
    totalScore: 80,
    rankScore: 400,
    requiredMet: 2,
    bonusMet: 2,
    criteria: {
      epsGrowth: { passed: true, value: 145.5, detail: "EPS YoY +145.5%" },
      revenueGrowth: { passed: true, value: 122.3, detail: "매출 YoY +122.3%" },
      epsAcceleration: { passed: true, value: 145.5, detail: "EPS 가속" },
      marginExpansion: { passed: true, value: 55.2, detail: "이익률 확대" },
      roe: { passed: false, value: null, detail: "ROE 데이터 미확보" },
    },
    ...overrides,
  };
}

// ─── formatFundamentalContext ─────────────────────────────────────────────────

describe("formatFundamentalContext", () => {
  it("빈 배열이면 빈 문자열을 반환한다", () => {
    const result = formatFundamentalContext([]);
    expect(result).toBe("");
  });

  it("단일 종목 정상 케이스 — XML 태그 없이 순수 마크다운 테이블을 반환한다", () => {
    const scores = [makeScore({ symbol: "NVDA", grade: "S" })];
    const result = formatFundamentalContext(scores);

    expect(result).not.toContain("<fundamental-data>");
    expect(result).not.toContain("</fundamental-data>");
    expect(result).toContain("| 종목 | 등급 | EPS YoY | 매출 YoY | EPS 가속 | 마진 확대 |");
    expect(result).toContain("| NVDA | S | +145.5% | +122.3% | 예 | 예 |");
    expect(result).toContain("※ 등급 기준: S(Top 3 of A) > A > B > C > F");
    expect(result).toContain("※ B등급 미만 종목을 추천할 경우 \"펀더멘탈 미검증\" 표기 필수");
  });

  it("여러 종목 — 모든 심볼이 테이블에 포함된다", () => {
    const scores = [
      makeScore({ symbol: "NVDA", grade: "S" }),
      makeScore({ symbol: "AMD", grade: "A" }),
      makeScore({ symbol: "INTC", grade: "B" }),
    ];
    const result = formatFundamentalContext(scores);

    expect(result).toContain("| NVDA | S |");
    expect(result).toContain("| AMD | A |");
    expect(result).toContain("| INTC | B |");
  });

  it("EPS YoY가 null이면 '—'로 표기한다", () => {
    const scores = [
      makeScore({
        symbol: "TEST",
        criteria: {
          epsGrowth: { passed: false, value: null, detail: "데이터 부족" },
          revenueGrowth: { passed: false, value: null, detail: "데이터 부족" },
          epsAcceleration: { passed: false, value: null, detail: "데이터 부족" },
          marginExpansion: { passed: false, value: null, detail: "데이터 부족" },
          roe: { passed: false, value: null, detail: "ROE 데이터 미확보" },
        },
      }),
    ];
    const result = formatFundamentalContext(scores);

    expect(result).toContain("| TEST | A | — | — | 아니오 | 아니오 |");
  });

  it("EPS YoY가 음수이면 마이너스 부호 그대로 표기한다", () => {
    const scores = [
      makeScore({
        symbol: "TEST",
        criteria: {
          epsGrowth: { passed: false, value: -30, detail: "EPS YoY -30%" },
          revenueGrowth: { passed: true, value: 50, detail: "매출 YoY +50%" },
          epsAcceleration: { passed: false, value: null, detail: "" },
          marginExpansion: { passed: false, value: null, detail: "" },
          roe: { passed: false, value: null, detail: "" },
        },
      }),
    ];
    const result = formatFundamentalContext(scores);

    expect(result).toContain("-30%");
    expect(result).toContain("+50%");
  });

  it("EPS 가속 미충족 시 '아니오'로 표기한다", () => {
    const scores = [
      makeScore({
        symbol: "TEST",
        criteria: {
          epsGrowth: { passed: true, value: 30, detail: "" },
          revenueGrowth: { passed: true, value: 30, detail: "" },
          epsAcceleration: { passed: false, value: null, detail: "미충족" },
          marginExpansion: { passed: true, value: 20, detail: "" },
          roe: { passed: false, value: null, detail: "" },
        },
      }),
    ];
    const result = formatFundamentalContext(scores);

    expect(result).toContain("| 아니오 |");
  });

  it("마크다운 테이블 구분선 행을 포함한다", () => {
    const scores = [makeScore()];
    const result = formatFundamentalContext(scores);

    expect(result).toContain("|------|------|---------|---------|---------|---------|");
  });
});

// ─── buildSynthesisPrompt 분기 검증 ──────────────────────────────────────────

function makeRoundOutput(persona: AgentPersona, content: string): RoundOutput {
  return { persona, content };
}

describe("buildSynthesisPrompt", () => {
  const round1 = [makeRoundOutput("macro", "매크로 분석 내용")];
  const round2 = [makeRoundOutput("macro", "교차 검증 내용")];
  const question = "오늘 시장은?";

  it("fundamentalContext가 주어지면 XML 래핑과 함께 프롬프트에 포함된다", () => {
    const fundamentalContext = "| NVDA | S | +145.5% | +122.3% | 예 | 예 |";
    const result = buildSynthesisPrompt(round1, round2, question, undefined, fundamentalContext);

    expect(result).toContain("<fundamental-data>");
    expect(result).toContain("</fundamental-data>");
    expect(result).toContain(fundamentalContext);
    expect(result).toContain("## 추천 종목 펀더멘탈 데이터");
  });

  it("fundamentalContext가 undefined이면 펀더멘탈 섹션이 포함되지 않는다", () => {
    const result = buildSynthesisPrompt(round1, round2, question, undefined, undefined);

    expect(result).not.toContain("<fundamental-data>");
    expect(result).not.toContain("</fundamental-data>");
    expect(result).not.toContain("추천 종목 펀더멘탈 데이터");
  });

  it("섹션 7에 마크다운 테이블 헤더가 포함된다", () => {
    const result = buildSynthesisPrompt(round1, round2, question, undefined, undefined);

    expect(result).toContain("| 날짜 | 이벤트 | 위 분석에 미치는 영향 |");
    expect(result).toContain("|------|--------|----------------------|");
  });

  it("agentPerformanceContext가 주어지면 프롬프트에 포함된다", () => {
    const perfContext = "## 에이전트별 Thesis 적중률\n| 분석가 | 적중률 |\n| macro | 100% |";
    const result = buildSynthesisPrompt(round1, round2, question, undefined, undefined, perfContext);

    expect(result).toContain("에이전트별 Thesis 적중률");
    expect(result).toContain("macro | 100%");
  });

  it("agentPerformanceContext가 undefined이면 성과 섹션이 포함되지 않는다", () => {
    const result = buildSynthesisPrompt(round1, round2, question, undefined, undefined, undefined);

    expect(result).not.toContain("에이전트별 Thesis 적중률");
  });

  it("earlyDetectionContext가 주어지면 XML 래핑과 함께 프롬프트에 포함된다", () => {
    const earlyCtx = "| AAPL | 45 | 0.0012 | 2.1x | Technology |";
    const result = buildSynthesisPrompt(round1, round2, question, undefined, undefined, undefined, earlyCtx);

    expect(result).toContain("<early-detection>");
    expect(result).toContain("</early-detection>");
    expect(result).toContain(earlyCtx);
    expect(result).toContain("조기포착 후보");
  });

  it("earlyDetectionContext가 있으면 moderator에 독립 평가 지시가 포함된다", () => {
    const earlyCtx = "| AAPL | 45 | 0.0012 | 2.1x | Technology |";
    const result = buildSynthesisPrompt(round1, round2, question, undefined, undefined, undefined, earlyCtx);

    expect(result).toContain("전문가가 언급하지 않은 조기포착 종목도 위 데이터를 직접 참조하여 Phase 2 전환 가능성을 평가하세요");
  });

  it("earlyDetectionContext가 undefined이면 조기포착 섹션이 포함되지 않는다", () => {
    const result = buildSynthesisPrompt(round1, round2, question, undefined, undefined, undefined, undefined);

    expect(result).not.toContain("<early-detection>");
    expect(result).not.toContain("조기포착 후보");
  });

  it("earlyDetectionContext가 빈 문자열이면 조기포착 섹션이 포함되지 않는다", () => {
    const result = buildSynthesisPrompt(round1, round2, question, undefined, undefined, undefined, "");

    expect(result).not.toContain("<early-detection>");
  });

  it("earlyDetectionContext는 fundamentalContext 뒤에 위치한다", () => {
    const fundCtx = "| NVDA | S | +145% |";
    const earlyCtx = "| AAPL | 45 |";
    const result = buildSynthesisPrompt(round1, round2, question, undefined, fundCtx, undefined, earlyCtx);

    const fundIdx = result.indexOf("<fundamental-data>");
    const earlyIdx = result.indexOf("<early-detection>");
    expect(fundIdx).toBeLessThan(earlyIdx);
  });

  it("short_term_outlook 카테고리가 프롬프트에서 제거되었다 (#845)", () => {
    const result = buildSynthesisPrompt(round1, round2, question, undefined, undefined);

    // short_term_outlook 관련 섹션이 제거됨
    expect(result).not.toContain("short_term_outlook 범위 제한");
    expect(result).toContain("short_term_outlook은 폐지");
    // structural_narrative와 sector_rotation만 남음
    expect(result).toContain("structural_narrative");
    expect(result).toContain("sector_rotation");
    // 허용 패턴은 유지
    expect(result).toContain("조건부 형식");
  });

  it("regimeContext가 주어지면 레짐 판정 섹션에 포함된다", () => {
    const regimeCtx = "### 이전 확정 레짐\n- **현재 확정 레짐**: EARLY_BEAR";
    const result = buildSynthesisPrompt(round1, round2, question, undefined, undefined, undefined, undefined, undefined, regimeCtx);

    expect(result).toContain("이전 확정 레짐");
    expect(result).toContain("EARLY_BEAR");
  });

  it("regimeContext가 undefined이면 이전 레짐 섹션이 포함되지 않는다", () => {
    const result = buildSynthesisPrompt(round1, round2, question);

    expect(result).not.toContain("이전 확정 레짐");
  });

  it("regimeContext가 빈 문자열이면 이전 레짐 섹션이 포함되지 않는다", () => {
    const result = buildSynthesisPrompt(round1, round2, question, undefined, undefined, undefined, undefined, undefined, "");

    expect(result).not.toContain("이전 확정 레짐");
  });

  it("regimeContext는 레짐 분류 기준 바로 앞에 위치한다", () => {
    const regimeCtx = "### 이전 확정 레짐\n- MID_BULL 확정";
    const result = buildSynthesisPrompt(round1, round2, question, undefined, undefined, undefined, undefined, undefined, regimeCtx);

    const regimeCtxIdx = result.indexOf("이전 확정 레짐");
    const classificationIdx = result.indexOf("레짐 분류 기준:");
    expect(regimeCtxIdx).toBeGreaterThan(-1);
    expect(classificationIdx).toBeGreaterThan(-1);
    expect(regimeCtxIdx).toBeLessThan(classificationIdx);
  });

  it("narrativeChainContext가 주어지면 narrative-chains XML 래핑과 함께 프롬프트에 포함된다", () => {
    const chainCtx = "## 현재 추적 중인 서사 체인\n| GPU 공급 부족 | AI 인프라 |";
    const result = buildSynthesisPrompt(round1, round2, question, undefined, undefined, undefined, undefined, undefined, undefined, chainCtx);

    expect(result).toContain("<narrative-chains>");
    expect(result).toContain("</narrative-chains>");
    expect(result).toContain("현재 추적 중인 서사 체인");
    expect(result).toContain("GPU 공급 부족");
  });

  it("narrativeChainContext가 undefined이면 서사 체인 섹션이 포함되지 않는다", () => {
    const result = buildSynthesisPrompt(round1, round2, question);

    expect(result).not.toContain("<narrative-chains>");
    expect(result).not.toContain("</narrative-chains>");
  });

  it("narrativeChainContext가 빈 문자열이면 서사 체인 섹션이 포함되지 않는다", () => {
    const result = buildSynthesisPrompt(round1, round2, question, undefined, undefined, undefined, undefined, undefined, undefined, "");

    expect(result).not.toContain("<narrative-chains>");
  });
});

// ─── formatRegimeContext ─────────────────────────────────────────────────────

describe("formatRegimeContext", () => {
  it("regime이 null이면 초기 상태 안내를 반환한다", () => {
    const result = formatRegimeContext(null, "2026-04-07");

    expect(result).toContain("이전 확정 레짐");
    expect(result).toContain("확정된 레짐이 없습니다");
    expect(result).toContain("제약 없이 판정");
  });

  it("regime이 있으면 확정 레짐명과 경과일수를 포함한다", () => {
    const regime: MarketRegimeRow = {
      regimeDate: "2026-04-03",
      regime: "EARLY_BEAR",
      rationale: "브레드스 급락",
      confidence: "high",
      isConfirmed: true,
      confirmedAt: "2026-04-03",
    };
    const result = formatRegimeContext(regime, "2026-04-07");

    expect(result).toContain("EARLY_BEAR");
    expect(result).toContain("2026-04-03 확정");
    expect(result).toContain("4일 경과");
  });

  it("허용 전환 경로를 포함한다", () => {
    const regime: MarketRegimeRow = {
      regimeDate: "2026-04-05",
      regime: "EARLY_BEAR",
      rationale: "테스트",
      confidence: "high",
      isConfirmed: true,
      confirmedAt: "2026-04-05",
    };
    const result = formatRegimeContext(regime, "2026-04-07");

    expect(result).toContain("EARLY_BEAR → BEAR / EARLY_BULL");
    expect(result).toContain("금지");
  });

  it("전체 허용 전환 매트릭스를 포함한다", () => {
    const regime: MarketRegimeRow = {
      regimeDate: "2026-04-05",
      regime: "MID_BULL",
      rationale: "테스트",
      confidence: "medium",
      isConfirmed: true,
      confirmedAt: "2026-04-05",
    };
    const result = formatRegimeContext(regime, "2026-04-07");

    expect(result).toContain("전체 허용 전환 매트릭스");
    expect(result).toContain("EARLY_BULL → MID_BULL / EARLY_BEAR");
    expect(result).toContain("LATE_BULL → MID_BULL / EARLY_BEAR");
    expect(result).toContain("BEAR → EARLY_BEAR");
  });

  it("경과일수가 0일이면 0일 경과로 표시한다", () => {
    const regime: MarketRegimeRow = {
      regimeDate: "2026-04-07",
      regime: "MID_BULL",
      rationale: "테스트",
      confidence: "high",
      isConfirmed: true,
      confirmedAt: "2026-04-07",
    };
    const result = formatRegimeContext(regime, "2026-04-07");

    expect(result).toContain("0일 경과");
  });
});

// ─── formatExistingThesesForSynthesis (#764) ────────────────────────────────

function makeThesisRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    debateDate: "2026-04-10",
    agentPersona: "geopolitics",
    thesis: "호르무즈 위기 → Energy RS 60일 지속",
    timeframeDays: 60,
    verificationMetric: "Energy RS",
    targetCondition: "Energy RS > 55",
    invalidationCondition: null,
    confidence: "high",
    consensusLevel: "3/4",
    category: "structural_narrative",
    status: "ACTIVE",
    verificationDate: null,
    verificationResult: null,
    causalAnalysis: null,
    closeReason: null,
    verificationMethod: null,
    nextBottleneck: null,
    consensusScore: 3,
    dissentReason: null,
    minorityView: null,
    consensusUnverified: null,
    isStatusQuo: null,
    contradictionDetected: null,
    createdAt: new Date("2026-04-10T00:00:00Z"),
    ...overrides,
  };
}

describe("formatExistingThesesForSynthesis", () => {
  it("빈 배열이면 빈 문자열을 반환한다", () => {
    expect(formatExistingThesesForSynthesis([])).toBe("");
  });

  it("단일 thesis를 에이전트 라벨과 함께 포맷한다", () => {
    const rows = [makeThesisRow()] as any;
    const result = formatExistingThesesForSynthesis(rows);

    expect(result).toContain("지정학 전략가");
    expect(result).toContain("[STRUCTURAL]");
    expect(result).toContain("[ACTIVE]");
    expect(result).toContain("호르무즈 위기");
    expect(result).toContain("Energy RS > 55");
  });

  it("CONFIRMED thesis의 status를 올바르게 표시한다", () => {
    const rows = [makeThesisRow({ status: "CONFIRMED" })] as any;
    const result = formatExistingThesesForSynthesis(rows);

    expect(result).toContain("[CONFIRMED]");
    expect(result).not.toContain("[ACTIVE]");
  });

  it("여러 에이전트의 thesis를 에이전트별로 그룹화한다", () => {
    const rows = [
      makeThesisRow({ id: 1, agentPersona: "geopolitics", thesis: "호르무즈 thesis" }),
      makeThesisRow({ id: 2, agentPersona: "macro", thesis: "금리 인하 thesis" }),
      makeThesisRow({ id: 3, agentPersona: "geopolitics", thesis: "대만 thesis" }),
    ] as any;
    const result = formatExistingThesesForSynthesis(rows);

    expect(result).toContain("지정학 전략가");
    expect(result).toContain("매크로 이코노미스트");
    // geopolitics 섹션에 두 thesis가 모두 포함
    expect(result).toContain("호르무즈 thesis");
    expect(result).toContain("대만 thesis");
    expect(result).toContain("금리 인하 thesis");
  });

  it("sector_rotation 카테고리는 ROTATION으로 표시한다", () => {
    const rows = [makeThesisRow({ category: "sector_rotation" })] as any;
    const result = formatExistingThesesForSynthesis(rows);

    expect(result).toContain("[ROTATION]");
  });

  it("알 수 없는 카테고리는 ROTATION으로 폴백한다", () => {
    const rows = [makeThesisRow({ category: "unknown_category" })] as any;
    const result = formatExistingThesesForSynthesis(rows);

    expect(result).toContain("[ROTATION]");
  });
});

// ─── DEDUP_LOOKBACK_DAYS (#764) ──────────────────────────────────────────────

describe("DEDUP_LOOKBACK_DAYS", () => {
  it("기본값이 7일이다", () => {
    expect(DEDUP_LOOKBACK_DAYS).toBe(7);
  });
});

// ─── buildSynthesisPrompt: existingThesesContext (#764) ──────────────────────

describe("buildSynthesisPrompt — existingThesesContext", () => {
  const round1: RoundOutput[] = [
    { persona: "macro" as AgentPersona, content: "매크로 분석" },
  ];
  const round2: RoundOutput[] = [
    { persona: "macro" as AgentPersona, content: "매크로 교차검증" },
  ];
  const question = "오늘의 시장 분석";

  it("existingThesesContext가 없으면 기존 thesis 섹션이 포함되지 않는다", () => {
    const prompt = buildSynthesisPrompt(round1, round2, question);

    expect(prompt).not.toContain("<existing-theses");
    expect(prompt).not.toContain("중복 생성 방지");
  });

  it("existingThesesContext가 빈 문자열이면 기존 thesis 섹션이 포함되지 않는다", () => {
    const prompt = buildSynthesisPrompt(round1, round2, question, undefined, undefined, undefined, undefined, undefined, undefined, undefined, "");

    expect(prompt).not.toContain("<existing-theses");
  });

  it("existingThesesContext가 제공되면 XML 태그와 중복 방지 규칙이 포함된다", () => {
    const context = "**지정학 전략가**:\n  - [STRUCTURAL][ACTIVE] 호르무즈 위기";
    const prompt = buildSynthesisPrompt(round1, round2, question, undefined, undefined, undefined, undefined, undefined, undefined, undefined, context);

    expect(prompt).toContain("<existing-theses trust=\"internal\">");
    expect(prompt).toContain("</existing-theses>");
    expect(prompt).toContain("중복 생성 방지");
    expect(prompt).toContain("호르무즈 위기");
    expect(prompt).toContain("주제·방향이 동일한");
    expect(prompt).toContain("호르무즈 봉쇄 vs 사우디 감산");
  });

  it("existingThesesContext는 분석가 그룹 섹션 앞에 위치한다", () => {
    const context = "기존 thesis 컨텍스트";
    const prompt = buildSynthesisPrompt(round1, round2, question, undefined, undefined, undefined, undefined, undefined, undefined, undefined, context);

    const existingIdx = prompt.indexOf("<existing-theses");
    const analysisIdx = prompt.indexOf("## 분석가 A 그룹");

    expect(existingIdx).toBeGreaterThan(-1);
    expect(analysisIdx).toBeGreaterThan(-1);
    expect(existingIdx).toBeLessThan(analysisIdx);
  });
});

// ─── logConditionParsability ────────────────────────────────────────────────

describe("logConditionParsability", () => {
  it("빈 배열이면 아무 로그도 남기지 않는다 (에러 없이 완료)", () => {
    expect(() => logConditionParsability([])).not.toThrow();
  });

  it("파싱 가능한 조건이면 경고 없이 처리된다", () => {
    const theses = [
      {
        agentPersona: "tech" as const,
        thesis: "기술 섹터 강세",
        targetCondition: "Technology RS > 60",
        invalidationCondition: "Technology RS < 40",
      },
    ] as any;

    expect(() => logConditionParsability(theses)).not.toThrow();
  });

  it("파싱 불가능한 조건이 있어도 에러 없이 처리된다 (경고 로그만)", () => {
    const theses = [
      {
        agentPersona: "geopolitics" as const,
        thesis: "지정학 리스크",
        targetCondition: "중동 긴장 고조로 에너지 가격 상승",
        invalidationCondition: null,
      },
    ] as any;

    expect(() => logConditionParsability(theses)).not.toThrow();
  });
});

// ─── buildSynthesisPrompt — 지원 지표 목록 주입 ─────────────────────────────

describe("buildSynthesisPrompt — 지원 지표 주입", () => {
  it("프롬프트에 시스템이 자동 검증 가능한 지표 전체 목록이 포함된다", () => {
    const round1: RoundOutput[] = [];
    const round2: RoundOutput[] = [];
    const prompt = buildSynthesisPrompt(round1, round2, "테스트 질문");

    expect(prompt).toContain("시스템이 자동 검증 가능한 지표 전체 목록");
    expect(prompt).toContain("HY OAS");
    expect(prompt).toContain("Financial Stress");
    expect(prompt).toContain("CCC spread");
    expect(prompt).toContain("BBB spread");
  });

  it("프롬프트에 신용 지표 예시가 포함된다", () => {
    const round1: RoundOutput[] = [];
    const round2: RoundOutput[] = [];
    const prompt = buildSynthesisPrompt(round1, round2, "테스트 질문");

    expect(prompt).toContain("HY OAS > 5.0");
    expect(prompt).toContain("Financial Stress > 2.0");
  });

  it("프롬프트에 geopolitics 에이전트 가이드가 포함된다", () => {
    const round1: RoundOutput[] = [];
    const round2: RoundOutput[] = [];
    const prompt = buildSynthesisPrompt(round1, round2, "테스트 질문");

    expect(prompt).toContain("geopolitics 에이전트 주의");
    expect(prompt).toContain("정량 프록시");
  });
});
