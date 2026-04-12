/**
 * 서사 체인 키워드 동의어 사전.
 *
 * 목적: 서로 다른 LLM이 같은 서사를 다른 표현으로 생성해도
 * 키워드 매칭에서 동일 서사로 인식되도록 정규화한다.
 *
 * 설계 원칙:
 * - canonical은 영어 소문자 (DB 검색·비교 일관성)
 * - 한글은 synonym으로만 등록
 * - 범용 단어 단독 등록 금지 (예: "supply" 단독 금지)
 * - 복합어는 복합어 단위로 등록 (예: "supply constraint" → shortage)
 * - 20-30 그룹으로 시작, 파편화 모니터링 후 점진 확장
 */

// ─── Types ──────────────────────────────────────────────────────────

export interface SynonymGroup {
  canonical: string;
  synonyms: string[];
}

// ─── Synonym Groups ─────────────────────────────────────────────────

export const SYNONYM_GROUPS: SynonymGroup[] = [
  // Hardware / Semiconductor
  { canonical: "semiconductor", synonyms: ["chip", "chips", "반도체", "칩"] },
  { canonical: "hbm", synonyms: ["high bandwidth memory", "고대역폭메모리", "고대역폭 메모리"] },
  { canonical: "dram", synonyms: ["디램"] },
  { canonical: "nand", synonyms: ["낸드"] },

  // Supply / Demand
  { canonical: "shortage", synonyms: ["supply constraint", "supply constraints", "supply crunch", "공급 부족", "공급부족", "공급 제약", "공급제약"] },
  { canonical: "bottleneck", synonyms: ["병목", "supply bottleneck", "supply bottlenecks", "공급 병목", "공급병목"] },
  { canonical: "supply_chain", synonyms: ["공급망", "공급 체인", "supply chain", "supply chains"] },
  { canonical: "oversupply", synonyms: ["공급 과잉", "공급과잉", "supply glut"] },

  // AI / Tech
  { canonical: "ai", synonyms: ["artificial intelligence", "인공지능"] },
  { canonical: "capex", synonyms: ["capital expenditure", "capital expenditures", "설비투자", "설비 투자", "infrastructure buildout", "인프라 투자", "인프라투자"] },
  { canonical: "datacenter", synonyms: ["data center", "data centers", "데이터센터", "데이터 센터"] },
  { canonical: "cloud", synonyms: ["클라우드"] },
  { canonical: "ev", synonyms: ["electric vehicle", "전기차", "전기 자동차"] },

  // Energy
  { canonical: "crude_oil", synonyms: ["원유", "crude oil"] },
  { canonical: "natural_gas", synonyms: ["천연가스", "천연 가스"] },
  { canonical: "energy_transition", synonyms: ["에너지 전환", "에너지전환", "clean energy transition"] },

  // Macro
  { canonical: "interest_rate", synonyms: ["금리", "기준금리", "interest rate", "interest rates", "policy rate"] },
  { canonical: "inflation", synonyms: ["인플레이션", "물가 상승", "물가상승"] },
  { canonical: "recession", synonyms: ["경기침체", "경기 침체", "불황"] },
  { canonical: "liquidity", synonyms: ["유동성"] },
  { canonical: "tariff", synonyms: ["관세"] },
  { canonical: "tightening", synonyms: ["긴축", "monetary tightening", "통화 긴축", "통화긴축"] },
  { canonical: "easing", synonyms: ["완화", "monetary easing", "통화 완화", "통화완화"] },

  // Market / Finance
  { canonical: "earnings", synonyms: ["실적", "어닝"] },
  { canonical: "valuation", synonyms: ["밸류에이션", "벨류에이션"] },
  { canonical: "buyback", synonyms: ["자사주 매입", "자사주매입", "share repurchase"] },
];

// ─── Lookup Maps (built once at module load) ────────────────────────

/** Multi-word phrases sorted by length descending for greedy matching. */
const MULTI_WORD_PHRASES: Array<[string, string]> = [];

/** Single-word token → canonical mapping. */
const SINGLE_WORD_MAP: Map<string, string> = new Map();

function buildMaps(): void {
  for (const group of SYNONYM_GROUPS) {
    for (const synonym of group.synonyms) {
      const lower = synonym.toLowerCase();
      if (lower.includes(" ")) {
        MULTI_WORD_PHRASES.push([lower, group.canonical]);
      } else {
        SINGLE_WORD_MAP.set(lower, group.canonical);
      }
    }
  }
  // Sort by length descending — longer phrases matched first to avoid partial replacements
  MULTI_WORD_PHRASES.sort((a, b) => b[0].length - a[0].length);
}

buildMaps();

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Replace multi-word synonym phrases in text with their canonical form.
 * Operates on lowercased, cleaned text (non-alphanum already replaced with spaces).
 * Longer phrases are matched first to prevent partial matches.
 */
export function replaceMultiWordSynonyms(text: string): string {
  let result = text;
  for (const [phrase, canonical] of MULTI_WORD_PHRASES) {
    if (result.includes(phrase)) {
      result = result.split(phrase).join(canonical);
    }
  }
  return result;
}

/**
 * Normalize a single keyword token to its canonical form.
 * Case-insensitive: input is lowercased before lookup.
 * Returns the token unchanged if no synonym mapping exists.
 */
export function normalizeSingleWord(word: string): string {
  return SINGLE_WORD_MAP.get(word.toLowerCase()) ?? word;
}
