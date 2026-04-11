/**
 * 메타 레짐 자동 관리 통합 테스트 (Step 4 / Issue #743)
 *
 * 검증 항목:
 * 1. syncMetaRegimeStatus — 체인 상태 기반 국면 상태 동기화
 * 2. findSimilarMetaRegime — 유사 국면 매칭 (keyword overlap)
 * 3. linkChainToMetaRegime — 체인-국면 연결
 * 4. transitionMetaRegimeStatus — PEAKED/RESOLVED 타임스탬프 세팅
 * 5. groupChainsByMegatrend (로컬 함수 재현) — megatrend 키워드 기반 그루핑
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── DB mock — factory 안에서 vi.fn() 정의 (호이스팅 안전) ──────────────────

const mockUpdateWhere = vi.fn().mockResolvedValue(undefined);
const mockUpdateSet = vi.fn().mockReturnValue({ where: mockUpdateWhere });
const mockUpdate = vi.fn().mockReturnValue({ set: mockUpdateSet });

const mockSelectWhere = vi.fn();
const mockSelectFrom = vi.fn().mockReturnValue({ where: mockSelectWhere });
const mockSelect = vi.fn().mockReturnValue({ from: mockSelectFrom });

vi.mock("@/db/client", () => ({
  db: {
    select: (...args: unknown[]) => mockSelect(...args),
    update: (...args: unknown[]) => mockUpdate(...args),
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown) => ({ eq: { col, val } }),
  inArray: (col: unknown, vals: unknown) => ({ inArray: { col, vals } }),
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
} from "../metaRegimeService.js";

// ─── 리셋 ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockSelect.mockReturnValue({ from: mockSelectFrom });
  mockSelectFrom.mockReturnValue({ where: mockSelectWhere });
  mockUpdate.mockReturnValue({ set: mockUpdateSet });
  mockUpdateSet.mockReturnValue({ where: mockUpdateWhere });
  mockUpdateWhere.mockResolvedValue(undefined);
});

// =============================================================================
// syncMetaRegimeStatus
// =============================================================================

describe("syncMetaRegimeStatus", () => {
  it("체인 0개이면 changed: false를 반환한다", async () => {
    // 첫 번째 select: 레짐 조회
    mockSelectWhere
      .mockResolvedValueOnce([{ id: 1, status: "ACTIVE" }])
      // 두 번째 select: 체인 목록 조회 (0개)
      .mockResolvedValueOnce([]);

    const result = await syncMetaRegimeStatus(1);

    expect(result.changed).toBe(false);
    expect(result.previousStatus).toBe("ACTIVE");
    expect(result.newStatus).toBe("ACTIVE");
  });

  it("현재 RESOLVED이면 역전이 없이 changed: false를 반환한다", async () => {
    // 레짐이 이미 RESOLVED
    mockSelectWhere.mockResolvedValueOnce([{ id: 1, status: "RESOLVED" }]);

    const result = await syncMetaRegimeStatus(1);

    expect(result.changed).toBe(false);
    expect(result.previousStatus).toBe("RESOLVED");
    expect(result.newStatus).toBe("RESOLVED");
    // 체인 조회 없이 바로 반환되어야 함
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

    // ACTIVE 체인이 존재 → ACTIVE 유지 → 상태 변화 없음
    expect(result.changed).toBe(false);
    expect(result.newStatus).toBe("ACTIVE");
    // update가 호출되지 않아야 함
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
    // 활성 국면 목록 반환
    mockSelectWhere.mockResolvedValueOnce([
      {
        id: 10,
        name: "AI 반도체 공급망 병목 국면",
        description: "AI 반도체 HBM 공급망 병목 확산",
      },
    ]);

    // 입력: name과 megatrends가 "AI 반도체 공급망 병목"과 3개 이상 겹침
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

    // 입력이 "에너지"와 전혀 관련 없음
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

    // id 31이 더 많은 키워드를 공유하므로 우선 반환
    expect(result?.id).toBe(31);
  });
});

// =============================================================================
// linkChainToMetaRegime
// =============================================================================

describe("linkChainToMetaRegime", () => {
  it("체인-국면 연결 시 update 쿼리가 올바르게 호출된다", async () => {
    await linkChainToMetaRegime(5, 10, 2);

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    // set 호출 인자 확인
    const setArgs = mockUpdateSet.mock.calls[0][0] as Record<string, unknown>;
    expect(setArgs.metaRegimeId).toBe(10);
    expect(setArgs.sequenceOrder).toBe(2);
  });

  it("DB 오류 발생 시 에러를 재던진다", async () => {
    const dbError = new Error("DB connection failed");
    mockUpdateWhere.mockRejectedValueOnce(dbError);

    await expect(linkChainToMetaRegime(5, 10, 2)).rejects.toThrow(
      "DB connection failed",
    );
  });
});

// =============================================================================
// transitionMetaRegimeStatus
// =============================================================================

describe("transitionMetaRegimeStatus", () => {
  it("PEAKED 전이 시 peakAt이 set payload에 포함된다", async () => {
    await transitionMetaRegimeStatus(1, "PEAKED");

    const setArgs = mockUpdateSet.mock.calls[0][0] as Record<string, unknown>;
    expect(setArgs.status).toBe("PEAKED");
    expect(setArgs.peakAt).toBeInstanceOf(Date);
    expect(setArgs.resolvedAt).toBeUndefined();
  });

  it("RESOLVED 전이 시 resolvedAt이 set payload에 포함된다", async () => {
    await transitionMetaRegimeStatus(2, "RESOLVED");

    const setArgs = mockUpdateSet.mock.calls[0][0] as Record<string, unknown>;
    expect(setArgs.status).toBe("RESOLVED");
    expect(setArgs.resolvedAt).toBeInstanceOf(Date);
    expect(setArgs.peakAt).toBeUndefined();
  });

  it("ACTIVE 전이 시 타임스탬프를 세팅하지 않는다", async () => {
    await transitionMetaRegimeStatus(3, "ACTIVE");

    const setArgs = mockUpdateSet.mock.calls[0][0] as Record<string, unknown>;
    expect(setArgs.status).toBe("ACTIVE");
    expect(setArgs.peakAt).toBeUndefined();
    expect(setArgs.resolvedAt).toBeUndefined();
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
// groupChainsByMegatrend (로컬 함수 재현 — run-debate-agent.ts에서 추출 불가)
//
// 동일 로직을 여기서 재현하여 핵심 그루핑 동작을 검증한다.
// 실제 함수와 동일한 알고리즘(MIN_OVERLAP=2, STOP words, keyword intersection)을 사용.
// =============================================================================

type UnlinkedChain = {
  id: number;
  megatrend: string;
  bottleneck: string;
  status: string;
};

function groupChainsByMegatrend(
  chains: UnlinkedChain[],
): Map<string, UnlinkedChain[]> {
  const STOP = new Set([
    "the", "a", "an", "in", "on", "at", "to", "for", "of", "is", "are", "was", "were",
    "의", "에", "에서", "로", "으로", "가", "이", "을", "를", "는", "은", "과", "와", "및",
  ]);

  const extractKw = (text: string): Set<string> =>
    new Set(
      text
        .toLowerCase()
        .replace(/[^a-zA-Z가-힣0-9\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length >= 2 && !STOP.has(w)),
    );

  const MIN_OVERLAP = 2;
  const groups: Array<{ keywords: Set<string>; chains: UnlinkedChain[] }> = [];

  for (const chain of chains) {
    const kw = extractKw(chain.megatrend);
    let merged = false;

    for (const group of groups) {
      let overlap = 0;
      for (const k of kw) {
        if (group.keywords.has(k)) overlap++;
      }
      if (overlap >= MIN_OVERLAP) {
        group.chains.push(chain);
        // 공통 키워드만 유지 (교집합)
        for (const gk of [...group.keywords]) {
          if (!kw.has(gk)) group.keywords.delete(gk);
        }
        merged = true;
        break;
      }
    }

    if (!merged) {
      groups.push({ keywords: new Set(kw), chains: [chain] });
    }
  }

  const result = new Map<string, UnlinkedChain[]>();
  for (const group of groups) {
    const key = [...group.keywords].sort().join(" ");
    if (key.length > 0) {
      result.set(key, group.chains);
    }
  }
  return result;
}

function makeChain(id: number, megatrend: string): UnlinkedChain {
  return { id, megatrend, bottleneck: "", status: "ACTIVE" };
}

describe("groupChainsByMegatrend", () => {
  it("동일 megatrend 키워드를 2개 이상 공유하는 체인 2개를 1개 그룹으로 묶는다", () => {
    const chains: UnlinkedChain[] = [
      makeChain(1, "AI 반도체 HBM 공급망 병목"),
      makeChain(2, "AI 반도체 수요 급증 사이클"),
      makeChain(3, "에너지 전환 풍력 태양광 확산"),
    ];

    const result = groupChainsByMegatrend(chains);

    // 체인 1, 2가 "AI 반도체" 공유 → 1개 그룹
    // 체인 3은 별도 그룹
    const groups = [...result.values()];
    const aiGroup = groups.find((g) => g.some((c) => c.id === 1 && g.some((c2) => c2.id === 2)));

    expect(aiGroup).toBeDefined();
    expect(aiGroup).toHaveLength(2);
    expect(aiGroup?.map((c) => c.id)).toContain(1);
    expect(aiGroup?.map((c) => c.id)).toContain(2);
  });

  it("모든 체인이 서로 다른 megatrend이면 각각 독립 그룹이 된다", () => {
    const chains: UnlinkedChain[] = [
      makeChain(1, "AI 반도체 HBM 병목"),
      makeChain(2, "에너지 전환 태양광 보조금"),
      makeChain(3, "금리 인상 연준 긴축 사이클"),
    ];

    const result = groupChainsByMegatrend(chains);

    // 각 체인이 키워드를 2개 이상 공유하지 않으므로 3개 그룹
    const totalChains = [...result.values()].reduce((sum, g) => sum + g.length, 0);
    expect(totalChains).toBe(3);

    // 각 그룹이 1개씩
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

    // 모두 "AI 반도체 HBM" 공유 → 1개 그룹
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
