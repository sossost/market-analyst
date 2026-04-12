/**
 * 동의어 사전 + 키워드 정규화 테스트 (Issue #753)
 *
 * 검증 항목:
 * 1. replaceMultiWordSynonyms — 복합어 구문을 canonical로 치환
 * 2. normalizeSingleWord — 개별 토큰을 canonical로 치환
 * 3. extractKeywords 통합 — 정규화 후 키워드 매칭이 동의어를 인식
 * 4. 과매칭 방지 — 관련 없는 표현이 잘못 매칭되지 않음
 */

import { describe, it, expect, vi } from "vitest";
import {
  replaceMultiWordSynonyms,
  normalizeSingleWord,
  SYNONYM_GROUPS,
} from "../synonymDictionary.js";

// ─── extractKeywords를 테스트하기 위한 mock 설정 ────────────────────────

vi.mock("@/db/client", () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
    }),
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
  inArray: vi.fn(),
  asc: vi.fn(),
  desc: vi.fn(),
  and: vi.fn(),
  isNull: vi.fn(),
  sql: vi.fn(),
}));

vi.mock("@/db/schema/analyst", () => ({
  metaRegimes: {},
  narrativeChains: {},
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/markdown", () => ({
  sanitizeCell: (s: unknown) => String(s),
}));

import { extractKeywords } from "../metaRegimeService.js";

// =============================================================================
// replaceMultiWordSynonyms
// =============================================================================

describe("replaceMultiWordSynonyms", () => {
  it("'supply constraint'를 'shortage'로 치환한다", () => {
    const result = replaceMultiWordSynonyms("semiconductor supply constraint");
    expect(result).toContain("shortage");
    expect(result).not.toContain("supply constraint");
  });

  it("'artificial intelligence'를 'ai'로 치환한다", () => {
    const result = replaceMultiWordSynonyms("artificial intelligence infrastructure");
    expect(result).toContain("ai");
    expect(result).not.toContain("artificial intelligence");
  });

  it("'공급 부족'을 'shortage'로 치환한다", () => {
    const result = replaceMultiWordSynonyms("반도체 공급 부족 심화");
    expect(result).toContain("shortage");
  });

  it("'supply chain'을 'supply_chain'으로 치환한다", () => {
    const result = replaceMultiWordSynonyms("global supply chain disruption");
    expect(result).toContain("supply_chain");
  });

  it("'에너지 전환'을 'energy_transition'으로 치환한다", () => {
    const result = replaceMultiWordSynonyms("에너지 전환 가속화");
    expect(result).toContain("energy_transition");
  });

  it("'infrastructure buildout'을 'capex'로 치환한다", () => {
    const result = replaceMultiWordSynonyms("ai infrastructure buildout cycle");
    expect(result).toContain("capex");
  });

  it("매칭되지 않는 텍스트는 그대로 반환한다", () => {
    const input = "unrelated text with no synonyms";
    expect(replaceMultiWordSynonyms(input)).toBe(input);
  });

  it("여러 복합어가 동시에 치환된다", () => {
    const result = replaceMultiWordSynonyms(
      "artificial intelligence infrastructure buildout and supply chain disruption",
    );
    expect(result).toContain("ai");
    expect(result).toContain("capex");
    expect(result).toContain("supply_chain");
  });
});

// =============================================================================
// normalizeSingleWord
// =============================================================================

describe("normalizeSingleWord", () => {
  it("'chip'을 'semiconductor'로 정규화한다", () => {
    expect(normalizeSingleWord("chip")).toBe("semiconductor");
  });

  it("'반도체'를 'semiconductor'로 정규화한다", () => {
    expect(normalizeSingleWord("반도체")).toBe("semiconductor");
  });

  it("'병목'을 'bottleneck'으로 정규화한다", () => {
    expect(normalizeSingleWord("병목")).toBe("bottleneck");
  });

  it("'인공지능'을 'ai'로 정규화한다", () => {
    expect(normalizeSingleWord("인공지능")).toBe("ai");
  });

  it("'금리'를 'interest_rate'로 정규화한다", () => {
    expect(normalizeSingleWord("금리")).toBe("interest_rate");
  });

  it("'원유'를 'crude_oil'로 정규화한다", () => {
    // 원유 is a single-word synonym for crude_oil
    expect(normalizeSingleWord("원유")).toBe("crude_oil");
  });

  it("'crude oil'은 multi-word 치환으로 정규화된다", () => {
    expect(replaceMultiWordSynonyms("crude oil price rally")).toContain("crude_oil");
  });

  it("대소문자 구분 없이 정규화한다", () => {
    expect(normalizeSingleWord("Chip")).toBe("semiconductor");
    expect(normalizeSingleWord("Chips")).toBe("semiconductor");
  });

  it("사전에 없는 단어는 그대로 반환한다", () => {
    expect(normalizeSingleWord("technology")).toBe("technology");
    expect(normalizeSingleWord("market")).toBe("market");
  });

  it("canonical 자체는 변환하지 않는다 (사전에 없으므로 그대로)", () => {
    expect(normalizeSingleWord("semiconductor")).toBe("semiconductor");
    expect(normalizeSingleWord("bottleneck")).toBe("bottleneck");
  });
});

// =============================================================================
// SYNONYM_GROUPS 구조 무결성
// =============================================================================

describe("SYNONYM_GROUPS 구조", () => {
  it("모든 canonical이 비어있지 않다", () => {
    for (const group of SYNONYM_GROUPS) {
      expect(group.canonical.length).toBeGreaterThan(0);
    }
  });

  it("모든 synonyms 배열에 최소 1개 항목이 있다", () => {
    for (const group of SYNONYM_GROUPS) {
      expect(group.synonyms.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("canonical이 중복되지 않는다", () => {
    const canonicals = SYNONYM_GROUPS.map((g) => g.canonical);
    expect(new Set(canonicals).size).toBe(canonicals.length);
  });

  it("synonym이 다른 그룹에 중복 등록되지 않는다", () => {
    const allSynonyms: string[] = [];
    for (const group of SYNONYM_GROUPS) {
      for (const s of group.synonyms) {
        allSynonyms.push(s.toLowerCase());
      }
    }
    expect(new Set(allSynonyms).size).toBe(allSynonyms.length);
  });
});

// =============================================================================
// extractKeywords 통합 — 이슈 #753의 핵심 매칭 시나리오
// =============================================================================

describe("extractKeywords 동의어 정규화 통합", () => {
  it("'chip shortage' vs 'semiconductor supply constraint' — 공통 키워드 존재", () => {
    const kwA = extractKeywords("chip shortage");
    const kwB = extractKeywords("semiconductor supply constraint");

    // 둘 다 "semiconductor"와 "shortage"를 포함해야 함
    expect(kwA.has("semiconductor")).toBe(true);
    expect(kwA.has("shortage")).toBe(true);
    expect(kwB.has("semiconductor")).toBe(true);
    expect(kwB.has("shortage")).toBe(true);

    // overlap 계산
    let overlap = 0;
    for (const kw of kwA) {
      if (kwB.has(kw)) overlap++;
    }
    expect(overlap).toBeGreaterThanOrEqual(2);
  });

  it("'AI infrastructure buildout' vs 'artificial intelligence capex cycle' — 공통 키워드 존재", () => {
    const kwA = extractKeywords("AI infrastructure buildout");
    const kwB = extractKeywords("artificial intelligence capex cycle");

    expect(kwA.has("ai")).toBe(true);
    expect(kwA.has("capex")).toBe(true);
    expect(kwB.has("ai")).toBe(true);
    expect(kwB.has("capex")).toBe(true);

    let overlap = 0;
    for (const kw of kwA) {
      if (kwB.has(kw)) overlap++;
    }
    expect(overlap).toBeGreaterThanOrEqual(2);
  });

  it("'에너지 공급망 병목' vs 'energy supply chain bottleneck' — 공통 키워드 존재", () => {
    const kwA = extractKeywords("에너지 공급망 병목");
    const kwB = extractKeywords("energy supply chain bottleneck");

    // 에너지→energy (stop word "전환"이 아님), 공급망→supply_chain, 병목→bottleneck
    expect(kwA.has("supply_chain")).toBe(true);
    expect(kwA.has("bottleneck")).toBe(true);
    expect(kwB.has("supply_chain")).toBe(true);
    expect(kwB.has("bottleneck")).toBe(true);

    let overlap = 0;
    for (const kw of kwA) {
      if (kwB.has(kw)) overlap++;
    }
    expect(overlap).toBeGreaterThanOrEqual(2);
  });

  it("관련 없는 서사끼리는 매칭되지 않는다 (과매칭 방지)", () => {
    const kwA = extractKeywords("semiconductor HBM shortage deepens");
    const kwB = extractKeywords("crude oil price rally continues");

    let overlap = 0;
    for (const kw of kwA) {
      if (kwB.has(kw)) overlap++;
    }
    expect(overlap).toBeLessThan(2);
  });

  it("영한 혼합 표현도 정규화된다", () => {
    const kwKorean = extractKeywords("반도체 공급 부족 심화");
    const kwEnglish = extractKeywords("semiconductor shortage worsening");

    expect(kwKorean.has("semiconductor")).toBe(true);
    expect(kwKorean.has("shortage")).toBe(true);
    expect(kwEnglish.has("semiconductor")).toBe(true);
    expect(kwEnglish.has("shortage")).toBe(true);
  });

  it("stop words는 정규화 후에도 제거된다", () => {
    const kw = extractKeywords("the chip is in a supply constraint");
    expect(kw.has("the")).toBe(false);
    expect(kw.has("is")).toBe(false);
    expect(kw.has("in")).toBe(false);
    // 정규화된 키워드는 존재
    expect(kw.has("semiconductor")).toBe(true);
    expect(kw.has("shortage")).toBe(true);
  });

  it("금리/매크로 한영 동의어가 정규화된다", () => {
    const kwA = extractKeywords("금리 인상 우려");
    const kwB = extractKeywords("interest rate hike concerns");

    expect(kwA.has("interest_rate")).toBe(true);
    expect(kwB.has("interest_rate")).toBe(true);
  });

  it("복수형(plural) 구문도 정규화된다", () => {
    expect(extractKeywords("interest rates rising").has("interest_rate")).toBe(true);
    expect(extractKeywords("supply chains disrupted").has("supply_chain")).toBe(true);
    expect(extractKeywords("data centers expanding").has("datacenter")).toBe(true);
    expect(extractKeywords("capital expenditures increase").has("capex")).toBe(true);
  });

  it("'crude'와 'lng' 같은 범용 단어는 단독으로 매핑되지 않는다 (과매칭 방지)", () => {
    const kw = extractKeywords("crude estimates show lng growth");
    expect(kw.has("crude_oil")).toBe(false);
    expect(kw.has("natural_gas")).toBe(false);
    // 원래 단어가 그대로 남아야 함
    expect(kw.has("crude")).toBe(true);
  });
});
