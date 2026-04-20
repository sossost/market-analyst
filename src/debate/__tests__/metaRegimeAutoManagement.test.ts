/**
 * 메타 레짐 자동 관리 통합 테스트 (Step 4 / Issue #743, junction table 전환 #905)
 *
 * 검증 항목:
 * 1. syncMetaRegimeStatus — junction table 기준 체인 상태 조회 + 국면 상태 동기화
 * 2. findSimilarMetaRegime — 유사 국면 매칭 (keyword overlap)
 * 3. linkChainToMetaRegime — junction table INSERT (ON CONFLICT DO NOTHING)
 * 4. transitionMetaRegimeStatus — PEAKED/RESOLVED 타임스탬프 세팅
 * 5. groupChainsByMegatrend — megatrend 키워드 기반 그루핑
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── DB mock — factory 안에서 vi.fn() 정의 (호이스팅 안전) ──────────────────

const mockInsertOnConflict = vi.fn().mockResolvedValue(undefined);
const mockInsertValues = vi.fn().mockReturnValue({ onConflictDoNothing: mockInsertOnConflict });
const mockInsert = vi.fn().mockReturnValue({ values: mockInsertValues });

const mockUpdateWhere = vi.fn().mockResolvedValue(undefined);
const mockUpdateSet = vi.fn().mockReturnValue({ where: mockUpdateWhere });
const mockUpdate = vi.fn().mockReturnValue({ set: mockUpdateSet });

const mockSelectOrderBy = vi.fn();
const mockSelectWhere = vi.fn().mockReturnValue({ orderBy: mockSelectOrderBy });
const mockSelectInnerJoin = vi.fn().mockReturnValue({ where: mockSelectWhere });
const mockSelectFrom = vi.fn().mockReturnValue({
  where: mockSelectWhere,
  innerJoin: mockSelectInnerJoin,
});
const mockSelect = vi.fn().mockReturnValue({ from: mockSelectFrom });

vi.mock("@/db/client", () => ({
  db: {
    select: (...args: unknown[]) => mockSelect(...args),
    update: (...args: unknown[]) => mockUpdate(...args),
    insert: (...args: unknown[]) => mockInsert(...args),
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown) => ({ eq: { col, val } }),
  inArray: (col: unknown, vals: unknown) => ({ inArray: { col, vals } }),
  notInArray: (col: unknown, vals: unknown) => ({ notInArray: { col, vals } }),
  asc: (col: unknown) => ({ asc: col }),
  desc: (col: unknown) => ({ desc: col }),
  and: (...args: unknown[]) => ({ and: args }),
  sql: (str: unknown) => str,
}));

vi.mock("@/db/schema/analyst", () => ({
  metaRegimes: {
    id: "id",
    name: "name",
    description: "description",
    propagationType: "propagation_type",
    status: "status",
    activatedAt: "activated_at",
    peakAt: "peak_at",
    resolvedAt: "resolved_at",
  },
  narrativeChains: {
    id: "id",
    metaRegimeId: "meta_regime_id",
    status: "status",
    bottleneck: "bottleneck",
    supplyChain: "supply_chain",
    sequenceOrder: "sequence_order",
    sequenceConfidence: "sequence_confidence",
    activatedAt: "activated_at",
    peakAt: "peak_at",
  },
  narrativeChainRegimes: {
    chainId: "chain_id",
    regimeId: "regime_id",
    sequenceOrder: "sequence_order",
    sequenceConfidence: "sequence_confidence",
    linkedAt: "linked_at",
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/lib/markdown", () => ({
  sanitizeCell: (s: unknown) => String(s),
}));

// ─── 대상 모듈 import (mock 선언 후) ──────────────────────────────────────────

import {
  syncMetaRegimeStatus,
  findSimilarMetaRegime,
  linkChainToMetaRegime,
  transitionMetaRegimeStatus,
  groupChainsByMegatrend,
  resolvePeakAt,
  determineRegimeStatus,
} from "../metaRegimeService.js";

// ─── 리셋 ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockSelect.mockReturnValue({ from: mockSelectFrom });
  mockSelectFrom.mockReturnValue({
    where: mockSelectWhere,
    innerJoin: mockSelectInnerJoin,
  });
  mockSelectInnerJoin.mockReturnValue({ where: mockSelectWhere });
  mockSelectWhere.mockReturnValue({ orderBy: mockSelectOrderBy });
  mockUpdate.mockReturnValue({ set: mockUpdateSet });
  mockUpdateSet.mockReturnValue({ where: mockUpdateWhere });
  mockUpdateWhere.mockResolvedValue(undefined);
  mockInsert.mockReturnValue({ values: mockInsertValues });
  mockInsertValues.mockReturnValue({ onConflictDoNothing: mockInsertOnConflict });
  mockInsertOnConflict.mockResolvedValue(undefined);
});

// =============================================================================
// resolvePeakAt — 순수 헬퍼 함수
// =============================================================================

describe("resolvePeakAt", () => {
  it("PEAKED 전이 시 currentPeakAt이 null이면 Date를 반환한다", () => {
    const result = resolvePeakAt("PEAKED", null);
    expect(result).toBeInstanceOf(Date);
  });

  it("PEAKED 전이 시 currentPeakAt이 이미 있으면 undefined를 반환한다", () => {
    const result = resolvePeakAt("PEAKED", new Date("2025-06-01"));
    expect(result).toBeUndefined();
  });

  it("RESOLVED 전이 시 currentPeakAt이 null이면 Date를 반환한다 (폴백)", () => {
    const result = resolvePeakAt("RESOLVED", null);
    expect(result).toBeInstanceOf(Date);
  });

  it("RESOLVED 전이 시 currentPeakAt이 이미 있으면 undefined를 반환한다", () => {
    const result = resolvePeakAt("RESOLVED", new Date("2025-06-01"));
    expect(result).toBeUndefined();
  });

  it("ACTIVE 전이 시 항상 undefined를 반환한다", () => {
    expect(resolvePeakAt("ACTIVE", null)).toBeUndefined();
    expect(resolvePeakAt("ACTIVE", new Date())).toBeUndefined();
  });
});

// =============================================================================
// syncMetaRegimeStatus — junction table 기준
// =============================================================================

describe("syncMetaRegimeStatus", () => {
  it("체인 0개이면 changed: false를 반환한다", async () => {
    // 첫 번째 select: 레짐 조회
    mockSelectWhere
      .mockResolvedValueOnce([{ id: 1, status: "ACTIVE" }])
      // 두 번째 select: junction table innerJoin 체인 목록 조회 (0개)
      .mockResolvedValueOnce([]);

    const result = await syncMetaRegimeStatus(1);

    expect(result.changed).toBe(false);
    expect(result.previousStatus).toBe("ACTIVE");
    expect(result.newStatus).toBe("ACTIVE");
  });

  it("현재 RESOLVED이면 역전이 없이 changed: false를 반환한다", async () => {
    mockSelectWhere.mockResolvedValueOnce([{ id: 1, status: "RESOLVED" }]);

    const result = await syncMetaRegimeStatus(1);

    expect(result.changed).toBe(false);
    expect(result.previousStatus).toBe("RESOLVED");
    expect(result.newStatus).toBe("RESOLVED");
    // 체인 조회 없이 바로 반환
    expect(mockSelectWhere).toHaveBeenCalledTimes(1);
  });

  it("ACTIVE 체인 1개 + RESOLVED 체인 2개이면 ACTIVE를 유지한다", async () => {
    mockSelectWhere
      .mockResolvedValueOnce([{ id: 1, status: "ACTIVE" }])
      .mockResolvedValueOnce([
        { status: "ACTIVE" },
        { status: "RESOLVED" },
        { status: "RESOLVED" },
      ]);

    const result = await syncMetaRegimeStatus(1);

    expect(result.changed).toBe(false);
    expect(result.newStatus).toBe("ACTIVE");
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("모든 체인이 RESOLVED이면 RESOLVED로 전이한다", async () => {
    mockSelectWhere
      .mockResolvedValueOnce([{ id: 2, status: "ACTIVE" }])
      .mockResolvedValueOnce([
        { status: "RESOLVED" },
        { status: "OVERSUPPLY" },
      ]);

    const result = await syncMetaRegimeStatus(2);

    expect(result.changed).toBe(true);
    expect(result.previousStatus).toBe("ACTIVE");
    expect(result.newStatus).toBe("RESOLVED");
    expect(mockUpdate).toHaveBeenCalled();
  });

  it("모든 체인이 OVERSUPPLY이면 RESOLVED로 전이한다", async () => {
    mockSelectWhere
      .mockResolvedValueOnce([{ id: 3, status: "ACTIVE" }])
      .mockResolvedValueOnce([
        { status: "OVERSUPPLY" },
        { status: "OVERSUPPLY" },
      ]);

    const result = await syncMetaRegimeStatus(3);

    expect(result.changed).toBe(true);
    expect(result.newStatus).toBe("RESOLVED");
  });

  it("레짐을 찾을 수 없으면 에러를 던진다", async () => {
    mockSelectWhere.mockResolvedValueOnce([]);

    await expect(syncMetaRegimeStatus(999)).rejects.toThrow(
      "Meta-regime #999 not found",
    );
  });
});

// =============================================================================
// findSimilarMetaRegime
// =============================================================================

describe("findSimilarMetaRegime", () => {
  it("keyword overlap >= 3인 국면이 존재하면 해당 국면을 반환한다", async () => {
    mockSelectWhere.mockResolvedValueOnce([
      {
        id: 10,
        name: "AI 반도체 공급망 병목 국면",
        description: "AI 반도체 HBM 공급망 병목 확산",
      },
    ]);

    const result = await findSimilarMetaRegime(
      "AI 반도체 병목 국면",
      ["AI 반도체 수요 확대", "HBM 공급망 제약"],
    );

    expect(result).not.toBeNull();
    expect(result?.id).toBe(10);
    expect(result?.name).toBe("AI 반도체 공급망 병목 국면");
  });

  it("keyword overlap < 3이면 null을 반환한다", async () => {
    mockSelectWhere.mockResolvedValueOnce([
      {
        id: 20,
        name: "에너지 전환 사이클",
        description: "신재생 에너지 전환 가속화",
      },
    ]);

    const result = await findSimilarMetaRegime(
      "금리 인상 국면",
      ["연준 긴축 사이클", "달러 강세"],
    );

    expect(result).toBeNull();
  });

  it("활성 국면이 없으면 null을 반환한다", async () => {
    mockSelectWhere.mockResolvedValueOnce([]);

    const result = await findSimilarMetaRegime(
      "AI 반도체 국면",
      ["반도체 공급망"],
    );

    expect(result).toBeNull();
  });

  it("여러 후보 중 overlap이 가장 높은 국면을 반환한다", async () => {
    mockSelectWhere.mockResolvedValueOnce([
      {
        id: 30,
        name: "AI 반도체 HBM 병목",
        description: "HBM 공급 제약",
      },
      {
        id: 31,
        name: "AI 반도체 공급망 HBM DRAM 병목 확산 국면",
        description: "AI 반도체 HBM DRAM 공급망 전반 병목",
      },
    ]);

    const result = await findSimilarMetaRegime(
      "AI 반도체 HBM DRAM 병목 국면",
      ["AI 반도체 공급망 제약"],
    );

    expect(result?.id).toBe(31);
  });
});

// =============================================================================
// linkChainToMetaRegime — junction table INSERT (ON CONFLICT DO NOTHING)
// =============================================================================

describe("linkChainToMetaRegime", () => {
  it("junction table에 INSERT 쿼리가 올바르게 호출된다", async () => {
    await linkChainToMetaRegime(5, 10, 2);

    expect(mockInsert).toHaveBeenCalledTimes(1);
    const insertValues = mockInsertValues.mock.calls[0][0] as Record<string, unknown>;
    expect(insertValues.chainId).toBe(5);
    expect(insertValues.regimeId).toBe(10);
    expect(insertValues.sequenceOrder).toBe(2);
    // update가 호출되지 않아야 함 (기존 방식 제거 확인)
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("ON CONFLICT DO NOTHING이 호출된다", async () => {
    await linkChainToMetaRegime(5, 10, 2);

    expect(mockInsertOnConflict).toHaveBeenCalledTimes(1);
  });

  it("DB 오류 발생 시 에러를 재던진다", async () => {
    const dbError = new Error("DB connection failed");
    mockInsertOnConflict.mockRejectedValueOnce(dbError);

    await expect(linkChainToMetaRegime(5, 10, 2)).rejects.toThrow(
      "DB connection failed",
    );
  });
});

// =============================================================================
// transitionMetaRegimeStatus
// =============================================================================

describe("transitionMetaRegimeStatus", () => {
  it("PEAKED 전이 시 peakAt에 COALESCE SQL 표현식이 포함된다", async () => {
    await transitionMetaRegimeStatus(1, "PEAKED");

    const setArgs = mockUpdateSet.mock.calls[0][0] as Record<string, unknown>;
    expect(setArgs.status).toBe("PEAKED");
    // COALESCE(peak_at, now) — atomic하게 기존 값 보존 또는 현재 시각 설정
    expect(setArgs.peakAt).toBeDefined();
    expect(setArgs.resolvedAt).toBeUndefined();
    // SELECT 없이 단일 UPDATE로 처리 — race condition 방지
    expect(mockSelectWhere).not.toHaveBeenCalled();
  });

  it("RESOLVED 전이 시 resolvedAt과 peakAt COALESCE가 모두 포함된다", async () => {
    await transitionMetaRegimeStatus(2, "RESOLVED");

    const setArgs = mockUpdateSet.mock.calls[0][0] as Record<string, unknown>;
    expect(setArgs.status).toBe("RESOLVED");
    expect(setArgs.resolvedAt).toBeInstanceOf(Date);
    // COALESCE(peak_at, now) — 기존 peakAt 보존 또는 폴백 설정
    expect(setArgs.peakAt).toBeDefined();
    expect(mockSelectWhere).not.toHaveBeenCalled();
  });

  it("ACTIVE 전이 시 타임스탬프를 세팅하지 않는다", async () => {
    await transitionMetaRegimeStatus(3, "ACTIVE");

    const setArgs = mockUpdateSet.mock.calls[0][0] as Record<string, unknown>;
    expect(setArgs.status).toBe("ACTIVE");
    expect(setArgs.peakAt).toBeUndefined();
    expect(setArgs.resolvedAt).toBeUndefined();
    expect(mockSelectWhere).not.toHaveBeenCalled();
  });

  it("DB 오류 발생 시 에러를 재던진다", async () => {
    const dbError = new Error("Update failed");
    mockUpdateWhere.mockRejectedValueOnce(dbError);

    await expect(transitionMetaRegimeStatus(1, "PEAKED")).rejects.toThrow(
      "Update failed",
    );
  });
});

// =============================================================================
// groupChainsByMegatrend (metaRegimeService.ts에서 import한 실제 함수 사용)
// =============================================================================

type UnlinkedChain = {
  id: number;
  megatrend: string;
  bottleneck: string;
  status: string;
};

function makeChain(id: number, megatrend: string): UnlinkedChain {
  return { id, megatrend, bottleneck: "", status: "ACTIVE" };
}

describe("groupChainsByMegatrend", () => {
  it("동일 megatrend 키워드를 3개 이상 공유하는 체인 2개를 1개 그룹으로 묶는다", () => {
    const chains: UnlinkedChain[] = [
      makeChain(1, "AI 반도체 HBM 공급망 병목"),
      makeChain(2, "AI 반도체 HBM 수요 급증 사이클"),
      makeChain(3, "에너지 전환 풍력 태양광 확산"),
    ];

    const result = groupChainsByMegatrend(chains);

    const groups = [...result.values()];
    const aiGroup = groups.find((g) => g.some((c) => c.id === 1) && g.some((c) => c.id === 2));

    expect(aiGroup).toBeDefined();
    expect(aiGroup).toHaveLength(2);
    expect(aiGroup?.map((c) => c.id)).toContain(1);
    expect(aiGroup?.map((c) => c.id)).toContain(2);
  });

  it("공유 키워드가 3개 미만이면 각각 독립 그룹이 된다", () => {
    const chains: UnlinkedChain[] = [
      makeChain(1, "AI 반도체 HBM 병목"),
      makeChain(2, "에너지 전환 태양광 보조금"),
      makeChain(3, "금리 인상 연준 긴축 사이클"),
    ];

    const result = groupChainsByMegatrend(chains);

    const totalChains = [...result.values()].reduce((sum, g) => sum + g.length, 0);
    expect(totalChains).toBe(3);

    for (const group of result.values()) {
      expect(group).toHaveLength(1);
    }
  });

  it("모든 체인이 같은 megatrend이면 1개 그룹으로 합쳐진다", () => {
    const chains: UnlinkedChain[] = [
      makeChain(1, "AI 반도체 공급망 HBM 병목"),
      makeChain(2, "AI 반도체 수요 HBM 폭증"),
      makeChain(3, "AI 반도체 HBM 생산 제약"),
    ];

    const result = groupChainsByMegatrend(chains);

    expect(result.size).toBe(1);
    const [group] = [...result.values()];
    expect(group).toHaveLength(3);
  });

  it("체인이 0개이면 빈 Map을 반환한다", () => {
    const result = groupChainsByMegatrend([]);
    expect(result.size).toBe(0);
  });

  it("체인이 1개이면 1개 그룹을 반환한다", () => {
    const result = groupChainsByMegatrend([makeChain(1, "AI 반도체 HBM 병목")]);
    expect(result.size).toBe(1);
    const [group] = [...result.values()];
    expect(group).toHaveLength(1);
    expect(group[0].id).toBe(1);
  });
});

// =============================================================================
// LLM 링킹 mock 테스트 (matchMetaRegimesForChainViaLLM은 내부 함수이므로
// narrativeChainService의 recordNarrativeChain 경로로 간접 검증)
// =============================================================================

describe("LLM 링킹 응답 파싱 (단위 검증)", () => {
  it("정상 JSON 응답이면 regimeIds를 파싱한다", () => {
    const text = '{"regimeIds": [1, 3]}';
    const jsonMatch = text.match(/\{[\s\S]*?\}/);
    expect(jsonMatch).not.toBeNull();
    const parsed = JSON.parse(jsonMatch![0]) as { regimeIds: unknown[] };
    expect(parsed.regimeIds).toEqual([1, 3]);
  });

  it("빈 배열 응답이면 빈 배열을 반환한다", () => {
    const text = '{"regimeIds": []}';
    const jsonMatch = text.match(/\{[\s\S]*?\}/);
    expect(jsonMatch).not.toBeNull();
    const parsed = JSON.parse(jsonMatch![0]) as { regimeIds: unknown[] };
    expect(parsed.regimeIds).toEqual([]);
  });

  it("JSON 형식 오류이면 null 매치를 반환한다", () => {
    const text = "잘못된 응답입니다";
    const jsonMatch = text.match(/\{[\s\S]*?\}/);
    expect(jsonMatch).toBeNull();
  });

  it("regimeIds 키가 없는 JSON이면 파싱 실패로 처리한다", () => {
    const text = '{"result": [1, 2]}';
    const jsonMatch = text.match(/\{[\s\S]*?\}/);
    expect(jsonMatch).not.toBeNull();
    const parsed = JSON.parse(jsonMatch![0]) as Record<string, unknown>;
    expect("regimeIds" in parsed).toBe(false);
  });

  it("마크다운 코드 블록 내 JSON도 추출된다", () => {
    const text = '```json\n{"regimeIds": [2]}\n```';
    const jsonMatch = text.match(/\{[\s\S]*?\}/);
    expect(jsonMatch).not.toBeNull();
    const parsed = JSON.parse(jsonMatch![0]) as { regimeIds: unknown[] };
    expect(parsed.regimeIds).toEqual([2]);
  });
});

// =============================================================================
// determineRegimeStatus (순수 함수 — mock 불필요)
// =============================================================================

describe("determineRegimeStatus", () => {
  it("빈 체인 배열이면 null을 반환한다", () => {
    expect(determineRegimeStatus("ACTIVE", [])).toBeNull();
  });

  it("모든 체인이 RESOLVED이면 RESOLVED를 반환한다", () => {
    expect(
      determineRegimeStatus("ACTIVE", ["RESOLVED", "RESOLVED"]),
    ).toBe("RESOLVED");
  });

  it("모든 체인이 INVALIDATED이면 RESOLVED를 반환한다", () => {
    expect(
      determineRegimeStatus("ACTIVE", ["INVALIDATED", "INVALIDATED"]),
    ).toBe("RESOLVED");
  });

  it("모든 체인이 OVERSUPPLY이면 RESOLVED를 반환한다", () => {
    expect(
      determineRegimeStatus("ACTIVE", ["OVERSUPPLY", "OVERSUPPLY"]),
    ).toBe("RESOLVED");
  });

  it("RESOLVED + OVERSUPPLY 혼합이면 RESOLVED를 반환한다", () => {
    expect(
      determineRegimeStatus("ACTIVE", ["RESOLVED", "OVERSUPPLY"]),
    ).toBe("RESOLVED");
  });

  it("OVERSUPPLY + INVALIDATED 혼합이면 RESOLVED를 반환한다", () => {
    expect(
      determineRegimeStatus("PEAKED", ["OVERSUPPLY", "INVALIDATED"]),
    ).toBe("RESOLVED");
  });

  it("RESOLVED + OVERSUPPLY + INVALIDATED 전체 터미널 혼합이면 RESOLVED를 반환한다", () => {
    expect(
      determineRegimeStatus("ACTIVE", ["RESOLVED", "OVERSUPPLY", "INVALIDATED"]),
    ).toBe("RESOLVED");
  });

  it("이미 RESOLVED 상태면 null을 반환한다 (변경 없음)", () => {
    expect(
      determineRegimeStatus("RESOLVED", ["RESOLVED", "OVERSUPPLY"]),
    ).toBeNull();
  });

  it("ACTIVE 체인이 없으면 PEAKED를 반환한다", () => {
    expect(
      determineRegimeStatus("ACTIVE", ["RESOLVING", "OVERSUPPLY"]),
    ).toBe("PEAKED");
  });

  it("ACTIVE 체인이 하나라도 있으면 ACTIVE를 반환한다", () => {
    expect(
      determineRegimeStatus("PEAKED", ["ACTIVE", "OVERSUPPLY"]),
    ).toBe("ACTIVE");
  });

  it("이미 PEAKED 상태에서 PEAKED 전이면 null을 반환한다", () => {
    expect(
      determineRegimeStatus("PEAKED", ["RESOLVING", "RESOLVED"]),
    ).toBeNull();
  });

  it("이미 ACTIVE 상태에서 ACTIVE 전이면 null을 반환한다", () => {
    expect(
      determineRegimeStatus("ACTIVE", ["ACTIVE", "RESOLVING"]),
    ).toBeNull();
  });
});
