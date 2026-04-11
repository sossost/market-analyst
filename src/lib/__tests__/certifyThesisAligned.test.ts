/**
 * certifyThesisAligned.test.ts — LLM 인증 로직 단위 테스트
 *
 * 순수 함수(parseCertificationResponse) + 통합 로직(certifyThesisAlignedCandidates) 테스트.
 * DB/LLM 호출은 모킹.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  parseCertificationResponse,
  type CertificationResult,
} from "../certifyThesisAligned";

// ─── parseCertificationResponse ──────────────────────────────────────────────

describe("parseCertificationResponse", () => {
  const symbols = ["CIEN", "INTC", "AXTI"];

  it("정상 JSON 배열 파싱", () => {
    const response = JSON.stringify([
      { symbol: "CIEN", certified: true, reason: "광트랜시버 직접 제조사" },
      { symbol: "INTC", certified: false, reason: "범용 반도체, thesis 무관" },
      { symbol: "AXTI", certified: false, reason: "화합물 반도체 기판, 간접 관련" },
    ]);

    const results = parseCertificationResponse(response, symbols);
    expect(results).toHaveLength(3);
    expect(results[0]).toEqual({
      symbol: "CIEN",
      certified: true,
      reason: "광트랜시버 직접 제조사",
    });
    expect(results[1]).toEqual({
      symbol: "INTC",
      certified: false,
      reason: "범용 반도체, thesis 무관",
    });
    expect(results[2]).toEqual({
      symbol: "AXTI",
      certified: false,
      reason: "화합물 반도체 기판, 간접 관련",
    });
  });

  it("코드 펜스로 감싼 JSON 파싱", () => {
    const response = "```json\n" + JSON.stringify([
      { symbol: "CIEN", certified: true, reason: "직접 관련" },
      { symbol: "INTC", certified: false, reason: "무관" },
      { symbol: "AXTI", certified: false, reason: "간접" },
    ]) + "\n```";

    const results = parseCertificationResponse(response, symbols);
    expect(results).toHaveLength(3);
    expect(results[0]!.certified).toBe(true);
    expect(results[1]!.certified).toBe(false);
  });

  it("앞뒤 텍스트가 있는 JSON 파싱", () => {
    const response = `Here are the results:\n${JSON.stringify([
      { symbol: "CIEN", certified: true, reason: "관련" },
      { symbol: "INTC", certified: false, reason: "무관" },
      { symbol: "AXTI", certified: false, reason: "간접" },
    ])}\nDone.`;

    const results = parseCertificationResponse(response, symbols);
    expect(results).toHaveLength(3);
    expect(results[0]!.certified).toBe(true);
  });

  it("누락된 종목은 미인증 처리", () => {
    const response = JSON.stringify([
      { symbol: "CIEN", certified: true, reason: "관련" },
      // INTC, AXTI 누락
    ]);

    const results = parseCertificationResponse(response, symbols);
    expect(results).toHaveLength(3);
    expect(results[0]!.certified).toBe(true);
    expect(results[1]).toEqual({
      symbol: "INTC",
      certified: false,
      reason: "LLM 응답에서 누락됨",
    });
    expect(results[2]).toEqual({
      symbol: "AXTI",
      certified: false,
      reason: "LLM 응답에서 누락됨",
    });
  });

  it("파싱 실패 시 전체 미인증", () => {
    const response = "This is not valid JSON at all";

    const results = parseCertificationResponse(response, symbols);
    expect(results).toHaveLength(3);
    for (const r of results) {
      expect(r.certified).toBe(false);
      expect(r.reason).toContain("파싱 실패");
    }
  });

  it("빈 문자열 시 전체 미인증", () => {
    const results = parseCertificationResponse("", symbols);
    expect(results).toHaveLength(3);
    for (const r of results) {
      expect(r.certified).toBe(false);
    }
  });

  it("배열이 아닌 JSON 시 전체 미인증", () => {
    const response = JSON.stringify({ symbol: "CIEN", certified: true });
    const results = parseCertificationResponse(response, symbols);
    expect(results).toHaveLength(3);
    for (const r of results) {
      expect(r.certified).toBe(false);
    }
  });

  it("reason 필드 없는 항목도 처리", () => {
    const response = JSON.stringify([
      { symbol: "CIEN", certified: true },
    ]);

    const results = parseCertificationResponse(response, ["CIEN"]);
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      symbol: "CIEN",
      certified: true,
      reason: "",
    });
  });

  it("잘못된 certified 타입은 무시하고 누락 처리", () => {
    const response = JSON.stringify([
      { symbol: "CIEN", certified: "yes", reason: "관련" }, // string instead of boolean
    ]);

    const results = parseCertificationResponse(response, ["CIEN"]);
    expect(results).toHaveLength(1);
    expect(results[0]!.certified).toBe(false);
    expect(results[0]!.reason).toBe("LLM 응답에서 누락됨");
  });

  it("빈 종목 목록이면 빈 결과", () => {
    const response = JSON.stringify([]);
    const results = parseCertificationResponse(response, []);
    expect(results).toHaveLength(0);
  });
});

// ─── certifyThesisAlignedCandidates (통합 테스트 — 모킹) ─────────────────────

// DB와 LLM을 모킹하여 전체 흐름 검증
vi.mock("@/db/client", () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("@/debate/llm/claudeCliProvider", () => ({
  ClaudeCliProvider: vi.fn().mockImplementation(() => ({
    call: vi.fn().mockResolvedValue({
      content: "[]",
      tokensUsed: { input: 0, output: 0 },
    }),
    dispose: vi.fn(),
  })),
}));

describe("certifyThesisAlignedCandidates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("빈 데이터는 그대로 반환", async () => {
    const { certifyThesisAlignedCandidates } = await import("../certifyThesisAligned");

    const emptyData = { chains: [], totalCandidates: 0, phase2Count: 0 };
    const result = await certifyThesisAlignedCandidates(emptyData);
    expect(result).toEqual(emptyData);
  });

  it("LLM이 인증한 종목만 필터링", async () => {
    const { db } = await import("@/db/client");
    const { ClaudeCliProvider } = await import("@/debate/llm/claudeCliProvider");

    // DB mocks: chain context + company profiles
    const mockSelect = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn()
          .mockResolvedValueOnce([
            // loadChainContexts result
            {
              id: 1,
              megatrend: "AI 인프라 확장",
              bottleneck: "광트랜시버 공급 부족",
              demandDriver: "데이터센터 GPU 수요 급증",
              supplyChain: "GPU → HBM → 광트랜시버 → 전력",
            },
          ])
          .mockResolvedValueOnce([
            // loadCompanyDescriptions result
            { symbol: "CIEN", description: "Ciena designs networking equipment." },
            { symbol: "INTC", description: "Intel designs general-purpose CPUs." },
          ]),
      }),
    });
    (db as any).select = mockSelect;

    // LLM mock: CIEN certified, INTC not
    const mockCall = vi.fn().mockResolvedValue({
      content: JSON.stringify([
        { symbol: "CIEN", certified: true, reason: "광트랜시버 직접 제조사" },
        { symbol: "INTC", certified: false, reason: "범용 반도체, thesis 무관" },
      ]),
      tokensUsed: { input: 500, output: 100 },
    });
    const mockDispose = vi.fn();
    (ClaudeCliProvider as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      call: mockCall,
      dispose: mockDispose,
    }));

    const { certifyThesisAlignedCandidates } = await import("../certifyThesisAligned");

    const input = {
      chains: [
        {
          chainId: 1,
          megatrend: "AI 인프라 확장",
          bottleneck: "광트랜시버 공급 부족",
          chainStatus: "ACTIVE" as const,
          alphaCompatible: true,
          daysSinceIdentified: 45,
          candidates: [
            {
              symbol: "CIEN",
              chainId: 1,
              megatrend: "AI 인프라 확장",
              bottleneck: "광트랜시버 공급 부족",
              chainStatus: "ACTIVE" as const,
              phase: 2,
              rsScore: 85,
              pctFromHigh52w: -5,
              sepaGrade: "S",
              sector: "Technology",
              industry: "Communication Equipment",
              marketCap: 10_000_000_000,
              gatePassCount: 4,
              gateTotalCount: 4,
              source: "llm" as const,
            },
            {
              symbol: "INTC",
              chainId: 1,
              megatrend: "AI 인프라 확장",
              bottleneck: "광트랜시버 공급 부족",
              chainStatus: "ACTIVE" as const,
              phase: 2,
              rsScore: 62,
              pctFromHigh52w: -15,
              sepaGrade: "B",
              sector: "Technology",
              industry: "Semiconductors",
              marketCap: 100_000_000_000,
              gatePassCount: 3,
              gateTotalCount: 4,
              source: "sector" as const,
            },
          ],
        },
      ],
      totalCandidates: 2,
      phase2Count: 2,
    };

    const result = await certifyThesisAlignedCandidates(input);

    // INTC가 필터링되어 CIEN만 남아야 함
    expect(result.chains).toHaveLength(1);
    expect(result.chains[0]!.candidates).toHaveLength(1);
    expect(result.chains[0]!.candidates[0]!.symbol).toBe("CIEN");
    expect(result.chains[0]!.candidates[0]!.certified).toBe(true);
    expect(result.totalCandidates).toBe(1);
    expect(result.phase2Count).toBe(1);

    // dispose 호출 확인
    expect(mockDispose).toHaveBeenCalled();
  });

  it("전량 탈락 시 체인 제거", async () => {
    const { db } = await import("@/db/client");
    const { ClaudeCliProvider } = await import("@/debate/llm/claudeCliProvider");

    const mockSelect = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn()
          .mockResolvedValueOnce([{
            id: 1,
            megatrend: "Test",
            bottleneck: "Test",
            demandDriver: "Test",
            supplyChain: "Test",
          }])
          .mockResolvedValueOnce([]),
      }),
    });
    (db as any).select = mockSelect;

    const mockCall = vi.fn().mockResolvedValue({
      content: JSON.stringify([
        { symbol: "AAAA", certified: false, reason: "무관" },
      ]),
      tokensUsed: { input: 100, output: 50 },
    });
    (ClaudeCliProvider as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      call: mockCall,
      dispose: vi.fn(),
    }));

    const { certifyThesisAlignedCandidates } = await import("../certifyThesisAligned");

    const input = {
      chains: [
        {
          chainId: 1,
          megatrend: "Test",
          bottleneck: "Test",
          chainStatus: "ACTIVE" as const,
          alphaCompatible: null,
          daysSinceIdentified: 10,
          candidates: [
            {
              symbol: "AAAA",
              chainId: 1,
              megatrend: "Test",
              bottleneck: "Test",
              chainStatus: "ACTIVE" as const,
              phase: 2,
              rsScore: 70,
              pctFromHigh52w: -10,
              sepaGrade: "A",
              sector: "Tech",
              industry: "Semiconductors",
              marketCap: 5_000_000_000,
              gatePassCount: 4,
              gateTotalCount: 4,
              source: "sector" as const,
            },
          ],
        },
      ],
      totalCandidates: 1,
      phase2Count: 1,
    };

    const result = await certifyThesisAlignedCandidates(input);
    expect(result.chains).toHaveLength(0);
    expect(result.totalCandidates).toBe(0);
    expect(result.phase2Count).toBe(0);
  });

  it("LLM 호출 실패 시 원본 체인 유지 (graceful degradation)", async () => {
    const { db } = await import("@/db/client");
    const { ClaudeCliProvider } = await import("@/debate/llm/claudeCliProvider");

    const mockSelect = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn()
          .mockResolvedValueOnce([{
            id: 1,
            megatrend: "Test",
            bottleneck: "Test",
            demandDriver: "Test",
            supplyChain: "Test",
          }])
          .mockResolvedValueOnce([]),
      }),
    });
    (db as any).select = mockSelect;

    // LLM이 에러 throw
    const mockCall = vi.fn().mockRejectedValue(new Error("CLI timeout"));
    (ClaudeCliProvider as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      call: mockCall,
      dispose: vi.fn(),
    }));

    const { certifyThesisAlignedCandidates } = await import("../certifyThesisAligned");

    const input = {
      chains: [
        {
          chainId: 1,
          megatrend: "Test",
          bottleneck: "Test",
          chainStatus: "ACTIVE" as const,
          alphaCompatible: null,
          daysSinceIdentified: 10,
          candidates: [
            {
              symbol: "AAAA",
              chainId: 1,
              megatrend: "Test",
              bottleneck: "Test",
              chainStatus: "ACTIVE" as const,
              phase: 2,
              rsScore: 70,
              pctFromHigh52w: -10,
              sepaGrade: "A",
              sector: "Tech",
              industry: "Semiconductors",
              marketCap: 5_000_000_000,
              gatePassCount: 4,
              gateTotalCount: 4,
              source: "sector" as const,
            },
          ],
        },
      ],
      totalCandidates: 1,
      phase2Count: 1,
    };

    const result = await certifyThesisAlignedCandidates(input);

    // LLM 실패 시 원본 체인이 그대로 유지되어야 함
    expect(result.chains).toHaveLength(1);
    expect(result.chains[0]!.candidates).toHaveLength(1);
    expect(result.chains[0]!.candidates[0]!.symbol).toBe("AAAA");
    expect(result.totalCandidates).toBe(1);
  });
});
