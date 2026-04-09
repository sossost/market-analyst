import { describe, it, expect } from "vitest";
import {
  extractThesisKeywords,
  computeAlgorithmicConsensus,
  verifyConsensusLevels,
} from "../consensusVerifier.js";
import type { RoundOutput, Thesis, AgentPersona } from "@/types/debate";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeThesis(overrides: Partial<Thesis> = {}): Thesis {
  return {
    agentPersona: "macro",
    thesis: "AI 반도체 수요 확대로 Technology 섹터 RS 상승 가속",
    timeframeDays: 60,
    verificationMetric: "Technology RS",
    targetCondition: "Technology RS > 65",
    confidence: "high",
    consensusLevel: "4/4",
    category: "structural_narrative",
    ...overrides,
  };
}

function makeRound1Outputs(contents: Record<AgentPersona, string>): RoundOutput[] {
  return (["macro", "tech", "geopolitics", "sentiment"] as AgentPersona[]).map(
    (persona) => ({
      persona,
      content: contents[persona] ?? "",
    }),
  );
}

// ─── extractThesisKeywords ───────────────────────────────────────────────────

describe("extractThesisKeywords", () => {
  it("영문 대문자 단어를 추출한다", () => {
    const keywords = extractThesisKeywords("AI 반도체 수요가 NASDAQ 상승을 견인");
    expect(keywords).toContain("AI");
    expect(keywords).toContain("NASDAQ");
  });

  it("한글 핵심 명사구를 추출한다 (2자 이상)", () => {
    const keywords = extractThesisKeywords("반도체 수요 증가로 인프라 투자 확대");
    expect(keywords).toContain("반도체");
    expect(keywords).toContain("수요");
    expect(keywords).toContain("인프라");
    expect(keywords).toContain("투자");
  });

  it("조사/어미는 제외한다", () => {
    const keywords = extractThesisKeywords("에서 으로 하는 되는");
    expect(keywords).not.toContain("에서");
    expect(keywords).not.toContain("으로");
    expect(keywords).not.toContain("하는");
  });

  it("중복을 제거한다", () => {
    const keywords = extractThesisKeywords("AI AI AI 반도체 반도체");
    const aiCount = keywords.filter((k) => k === "AI").length;
    expect(aiCount).toBe(1);
  });

  it("빈 문자열이면 빈 배열을 반환한다", () => {
    expect(extractThesisKeywords("")).toEqual([]);
  });

  it("Technology 같은 혼합 케이스도 추출한다", () => {
    const keywords = extractThesisKeywords("Technology 섹터 RS 상승");
    expect(keywords).toContain("Technology");
    expect(keywords).toContain("RS");
  });
});

// ─── computeAlgorithmicConsensus ─────────────────────────────────────────────

describe("computeAlgorithmicConsensus", () => {
  it("전원 지지 시 4/4를 반환한다", () => {
    const thesis = makeThesis({
      agentPersona: "macro",
      thesis: "AI 반도체 수요 확대",
    });
    const outputs = makeRound1Outputs({
      macro: "AI 반도체 수요가 확대되고 있으며 성장 가속 중",
      tech: "AI 반도체 수요 확대를 강조하며 기회 포착",
      geopolitics: "AI 반도체 수요 확대에 긍정적, 수혜 가능",
      sentiment: "AI 반도체 수요 확대 가속에 낙관적 전망",
    });

    const result = computeAlgorithmicConsensus(thesis, outputs);
    expect(result.algorithmicConsensus).toBe("4/4");
    expect(result.supportCount).toBe(4);
  });

  it("thesis 제출자는 자동 지지로 판정한다", () => {
    const thesis = makeThesis({
      agentPersona: "tech",
      thesis: "AI 인프라 확장",
    });
    const outputs = makeRound1Outputs({
      macro: "",
      tech: "", // 출력이 비어도 자동 지지
      geopolitics: "",
      sentiment: "",
    });

    const result = computeAlgorithmicConsensus(thesis, outputs);
    const techDetail = result.details.find((d) => d.persona === "tech");
    expect(techDetail?.verdict).toBe("support");
  });

  it("키워드가 부정 맥락에서만 등장하면 미지지로 판정한다", () => {
    const thesis = makeThesis({
      agentPersona: "macro",
      thesis: "유가 급등으로 인플레이션 재발",
    });
    const outputs = makeRound1Outputs({
      macro: "유가 급등 인플레이션 재발 가능성 성장",
      tech: "유가 급등 리스크 우려 부정 인플레이션 반박 위험",
      geopolitics: "유가 반대 경고 우려 인플레이션 약화 둔화",
      sentiment: "유가 부정 하락 우려 인플레이션 리스크 경고",
    });

    const result = computeAlgorithmicConsensus(thesis, outputs);
    // macro는 제출자 (자동 지지), tech/geo/sentiment는 부정
    const nonAuthorSupport = result.details
      .filter((d) => d.persona !== "macro")
      .filter((d) => d.verdict === "support").length;
    expect(nonAuthorSupport).toBeLessThanOrEqual(1);
  });

  it("관련 키워드가 전혀 없는 에이전트는 absent로 판정한다", () => {
    const thesis = makeThesis({
      agentPersona: "macro",
      thesis: "유가 상승으로 에너지 섹터 강세",
    });
    const outputs = makeRound1Outputs({
      macro: "유가 상승으로 에너지 섹터 확대",
      tech: "완전히 다른 주제에 대해 이야기하고 있습니다", // 키워드 없음
      geopolitics: "유가 상승 가속 강조",
      sentiment: "에너지 섹터 낙관 기회",
    });

    const result = computeAlgorithmicConsensus(thesis, outputs);
    const techDetail = result.details.find((d) => d.persona === "tech");
    expect(techDetail?.verdict).toBe("absent");
  });

  it("키워드가 없으면 전원 지지로 처리한다 (보수적)", () => {
    const thesis = makeThesis({ thesis: "." }); // 키워드 추출 불가
    const outputs = makeRound1Outputs({
      macro: "아무 내용",
      tech: "아무 내용",
      geopolitics: "아무 내용",
      sentiment: "아무 내용",
    });

    const result = computeAlgorithmicConsensus(thesis, outputs);
    expect(result.algorithmicConsensus).toBe("4/4");
    expect(result.keywords).toEqual([]);
  });

  it("긍정/부정 동률 시 보수적으로 oppose 판정한다 (tie-break)", () => {
    const thesis = makeThesis({
      agentPersona: "macro",
      thesis: "반도체 공급 과잉 전환",
    });
    // tech: "반도체"가 긍정(확대) + 부정(우려) 동시 존재 → 동률 → oppose
    const outputs = makeRound1Outputs({
      macro: "반도체 공급 과잉 전환 가능성 확대",
      tech: "반도체 확대 성장 공급 우려 리스크 과잉 반박",
      geopolitics: "반도체 공급 확대 성장 긍정",
      sentiment: "반도체 과잉 낙관 기회",
    });

    const result = computeAlgorithmicConsensus(thesis, outputs);
    // tech의 verdict는 tie-break에 의해 oppose 또는 support (SUPPORT_THRESHOLD에 따라)
    // 핵심: "absent"가 되면 안 됨 — 키워드가 발견되었으므로
    const techDetail = result.details.find((d) => d.persona === "tech");
    expect(techDetail?.verdict).not.toBe("absent");
  });
});

// ─── verifyConsensusLevels ───────────────────────────────────────────────────

describe("verifyConsensusLevels", () => {
  it("2단계 이상 차이가 나면 consensusUnverified를 true로 설정한다", () => {
    const thesis = makeThesis({
      agentPersona: "macro",
      thesis: "유가 급등으로 에너지 상승 전환",
      consensusLevel: "4/4",
    });
    const outputs = makeRound1Outputs({
      macro: "유가 급등으로 에너지 상승 확대 가속 성장",
      tech: "유가 급등에 반박 우려 리스크 부정적",
      geopolitics: "에너지 반대 위험 경고 약화 둔화",
      sentiment: "유가 급등 반대 우려 부정 하락",
    });

    const { theses: result, verificationRan } = verifyConsensusLevels([thesis], outputs);
    expect(verificationRan).toBe(true);
    expect(result[0].consensusUnverified).toBe(true);
  });

  it("1단계 차이는 플래그를 부착하지 않는다", () => {
    const thesis = makeThesis({
      agentPersona: "macro",
      thesis: "AI 반도체 수요 확대",
      consensusLevel: "4/4",
    });
    const outputs = makeRound1Outputs({
      macro: "AI 반도체 수요 확대 성장 가속",
      tech: "AI 반도체 수요 확대 강조 기회",
      geopolitics: "AI 반도체 수요 확대 수혜 긍정",
      sentiment: "반도체 리스크 우려 반박 부정",
    });

    const { theses: result } = verifyConsensusLevels([thesis], outputs);
    // 3/4 vs 4/4 → gap=1 → 플래그 안 붙음
    expect(result[0].consensusUnverified).toBeUndefined();
  });

  it("Round 1 에이전트가 4명이 아니면 검증을 스킵하고 verificationRan=false 반환", () => {
    const thesis = makeThesis({ consensusLevel: "4/4" });
    const outputs: RoundOutput[] = [
      { persona: "macro", content: "내용" },
      { persona: "tech", content: "내용" },
    ];

    const { theses: result, verificationRan } = verifyConsensusLevels([thesis], outputs);
    expect(verificationRan).toBe(false);
    expect(result[0].consensusUnverified).toBeUndefined();
  });

  it("여러 thesis를 동시에 검증한다", () => {
    const theses = [
      makeThesis({
        agentPersona: "macro",
        thesis: "AI 반도체 수요 확대",
        consensusLevel: "4/4",
      }),
      makeThesis({
        agentPersona: "tech",
        thesis: "유가 급등 에너지 상승",
        consensusLevel: "1/4",
      }),
    ];
    const outputs = makeRound1Outputs({
      macro: "AI 반도체 수요 확대 성장 가속 강조",
      tech: "유가 급등 에너지 상승 강조 확대 가속 기회",
      geopolitics: "AI 반도체 수요 확대 긍정 기회 유가 급등 에너지 상승 수혜",
      sentiment: "AI 반도체 수요 확대 낙관 유가 급등 에너지 상승 낙관",
    });

    const { theses: result } = verifyConsensusLevels(theses, outputs);
    expect(result).toHaveLength(2);
    // 첫 번째: 모두 지지 → 4/4 vs 4/4 → 플래그 없음
    expect(result[0].consensusUnverified).toBeUndefined();
    // 두 번째: 모두 지지 → 4/4 vs 1/4 → gap=3 → 플래그
    expect(result[1].consensusUnverified).toBe(true);
  });

  it("원본 thesis 배열을 변경하지 않는다 (immutability)", () => {
    const original = makeThesis({ consensusLevel: "4/4" });
    const outputs = makeRound1Outputs({
      macro: "반도체 수요 확대 가속 성장",
      tech: "반도체 수요 확대 강조 기회",
      geopolitics: "반도체 수요 확대 긍정",
      sentiment: "반도체 수요 확대 낙관",
    });

    verifyConsensusLevels([original], outputs);
    expect(original).not.toHaveProperty("consensusUnverified");
  });

  it("verificationRan=true이면 검증이 실행된 것을 보장한다", () => {
    const thesis = makeThesis({ consensusLevel: "3/4" });
    const outputs = makeRound1Outputs({
      macro: "반도체 수요 확대 가속 성장",
      tech: "반도체 수요 확대 강조 기회",
      geopolitics: "반도체 수요 확대 긍정",
      sentiment: "반도체 수요 확대 낙관",
    });

    const { verificationRan } = verifyConsensusLevels([thesis], outputs);
    expect(verificationRan).toBe(true);
  });
});
