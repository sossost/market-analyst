import { describe, it, expect } from "vitest";
import { formatFundamentalContext, buildSynthesisPrompt } from "../round3-synthesis.js";
import type { FundamentalScore } from "../../../types/fundamental.js";
import type { RoundOutput, AgentPersona } from "../../../types/debate.js";

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
});
