/**
 * themeExtractor.test.ts — LLM 뉴스 테마 추출 단위 테스트
 *
 * parseThemeResponse()는 순수 함수 — 모킹 불필요.
 * callThemeExtraction(), saveThemes(), extractAndSaveThemes()는 외부 의존성 모킹.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  parseThemeResponse,
  callThemeExtraction,
  saveThemes,
  extractAndSaveThemes,
  type NewsTheme,
  type NewsItem,
} from "../themeExtractor";

// ─── 모킹 ──────────────────────────────────────────────────────────────────

vi.mock("@/lib/anthropic-client", () => ({
  getAnthropicClient: vi.fn(() => ({
    messages: {
      create: vi.fn(),
    },
  })),
}));

vi.mock("@/db/client", () => ({
  db: {
    insert: vi.fn(() => ({
      values: vi.fn(() => Promise.resolve({ rowCount: 1 })),
    })),
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// ─── parseThemeResponse ──────────────────────────────────────────────

describe("parseThemeResponse", () => {
  const validThemes: NewsTheme[] = [
    {
      theme: "PE/CLO 신용경색",
      impactedIndustries: ["Software - Application", "Software - Infrastructure"],
      impactMechanism: "PE 포트폴리오 기업 밸류에이션 하락 → 매도 압력",
      severity: "high",
      sourceCount: 8,
    },
    {
      theme: "AI 반도체 공급 부족",
      impactedIndustries: ["Semiconductors", "Semiconductor Equipment & Materials"],
      impactMechanism: "데이터센터 수요 급증 → GPU 리드타임 연장",
      severity: "medium",
      sourceCount: 5,
    },
  ];

  it("정상 JSON 배열 파싱", () => {
    const response = JSON.stringify(validThemes);
    const result = parseThemeResponse(response);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(validThemes[0]);
    expect(result[1]).toEqual(validThemes[1]);
  });

  it("코드 펜스로 감싼 JSON 파싱", () => {
    const response = "```json\n" + JSON.stringify(validThemes) + "\n```";
    const result = parseThemeResponse(response);

    expect(result).toHaveLength(2);
    expect(result[0]!.theme).toBe("PE/CLO 신용경색");
  });

  it("앞뒤 텍스트가 있는 JSON 파싱", () => {
    const response = `Here are the themes:\n${JSON.stringify(validThemes)}\n\nNote: these are extracted.`;
    const result = parseThemeResponse(response);

    expect(result).toHaveLength(2);
  });

  it("빈 배열 파싱", () => {
    const result = parseThemeResponse("[]");
    expect(result).toHaveLength(0);
  });

  it("JSON이 없으면 빈 배열 반환", () => {
    const result = parseThemeResponse("No themes found today.");
    expect(result).toHaveLength(0);
  });

  it("잘못된 JSON이면 빈 배열 반환", () => {
    const result = parseThemeResponse("[{invalid json}]");
    expect(result).toHaveLength(0);
  });

  it("배열이 아닌 JSON이면 빈 배열 반환", () => {
    const result = parseThemeResponse('{"theme": "test"}');
    expect(result).toHaveLength(0);
  });

  it("유효하지 않은 severity는 필터링", () => {
    const themes = [
      {
        theme: "테스트",
        impactedIndustries: ["Semiconductors"],
        impactMechanism: "테스트 메커니즘",
        severity: "critical", // 유효하지 않음
        sourceCount: 3,
      },
      {
        theme: "유효한 테마",
        impactedIndustries: ["Banks - Regional"],
        impactMechanism: "유효한 메커니즘",
        severity: "high",
        sourceCount: 5,
      },
    ];

    const result = parseThemeResponse(JSON.stringify(themes));
    expect(result).toHaveLength(1);
    expect(result[0]!.theme).toBe("유효한 테마");
  });

  it("impactedIndustries가 빈 배열이면 필터링", () => {
    const themes = [
      {
        theme: "빈 업종",
        impactedIndustries: [],
        impactMechanism: "메커니즘",
        severity: "high",
        sourceCount: 3,
      },
    ];

    const result = parseThemeResponse(JSON.stringify(themes));
    expect(result).toHaveLength(0);
  });

  it("필수 필드가 누락된 항목은 필터링", () => {
    const themes = [
      {
        theme: "필드 누락",
        // impactedIndustries 누락
        impactMechanism: "메커니즘",
        severity: "high",
        sourceCount: 3,
      },
      {
        theme: "정상",
        impactedIndustries: ["Semiconductors"],
        impactMechanism: "메커니즘",
        severity: "low",
        sourceCount: 2,
      },
    ];

    const result = parseThemeResponse(JSON.stringify(themes));
    expect(result).toHaveLength(1);
    expect(result[0]!.theme).toBe("정상");
  });

  it("sourceCount가 음수이면 1로 보정", () => {
    const themes = [
      {
        theme: "음수 카운트",
        impactedIndustries: ["Semiconductors"],
        impactMechanism: "메커니즘",
        severity: "high",
        sourceCount: -2,
      },
    ];

    const result = parseThemeResponse(JSON.stringify(themes));
    expect(result).toHaveLength(1);
    expect(result[0]!.sourceCount).toBe(1);
  });

  it("sourceCount가 소수점이면 반올림", () => {
    const themes = [
      {
        theme: "소수점 카운트",
        impactedIndustries: ["Semiconductors"],
        impactMechanism: "메커니즘",
        severity: "high",
        sourceCount: 4.7,
      },
    ];

    const result = parseThemeResponse(JSON.stringify(themes));
    expect(result).toHaveLength(1);
    expect(result[0]!.sourceCount).toBe(5);
  });

  it("impactedIndustries에서 빈 문자열을 필터링", () => {
    const themes = [
      {
        theme: "빈 문자열 포함",
        impactedIndustries: ["Semiconductors", "", "Banks - Regional"],
        impactMechanism: "메커니즘",
        severity: "high",
        sourceCount: 3,
      },
    ];

    const result = parseThemeResponse(JSON.stringify(themes));
    expect(result).toHaveLength(1);
    expect(result[0]!.impactedIndustries).toEqual(["Semiconductors", "Banks - Regional"]);
  });

  it("null 항목은 필터링", () => {
    const response = JSON.stringify([null, validThemes[0], undefined, validThemes[1]]);
    const result = parseThemeResponse(response);
    expect(result).toHaveLength(2);
  });
});

// ─── extractAndSaveThemes ─────────────────────────────────────────────

describe("extractAndSaveThemes", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("뉴스가 최소 건수 미만이면 스킵", async () => {
    const newsItems: NewsItem[] = [
      { title: "test1", description: null, category: "MARKET", source: "test.com" },
      { title: "test2", description: null, category: "POLICY", source: "test.com" },
    ];

    const result = await extractAndSaveThemes(newsItems, "2026-04-12");
    expect(result).toEqual({ extracted: 0, saved: 0 });
  });
});
