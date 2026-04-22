/**
 * newsLoader — fetchNewsForDailyReport 단위 테스트.
 * DB 의존성은 fetchRecentNews를 mock하여 제거한다.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NewsItemForReport } from "../newsLoader.js";

// fetchRecentNews는 DB에 의존하므로 모듈 전체를 mock
vi.mock("../newsLoader.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../newsLoader.js")>();
  return {
    ...actual,
    // fetchRecentNews는 개별 테스트에서 필요 시 spy로 제어
  };
});

// fetchNewsForDailyReport 내부에서 사용하는 DB를 mock
vi.mock("@/db/client", () => ({
  db: {
    select: vi.fn(),
  },
}));

// drizzle 체인 mock을 위한 헬퍼
function makeDrizzleChain(result: unknown[]) {
  const chain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(result),
  };
  return chain;
}

describe("fetchNewsForDailyReport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("DB 뉴스 0건이면 빈 배열을 반환한다", async () => {
    const { db } = await import("@/db/client");
    vi.mocked(db.select).mockReturnValue(makeDrizzleChain([]) as never);

    const { fetchNewsForDailyReport } = await import("../newsLoader.js");
    const result = await fetchNewsForDailyReport();

    expect(result).toEqual([]);
  });

  it("각 카테고리별로 쿼리를 실행한다 (6카테고리)", async () => {
    const { db } = await import("@/db/client");
    const mockItem: NewsItemForReport = {
      title: "Test News",
      source: "reuters.com",
      url: "https://reuters.com/test",
      category: "POLICY",
    };
    vi.mocked(db.select).mockReturnValue(makeDrizzleChain([mockItem]) as never);

    const { fetchNewsForDailyReport } = await import("../newsLoader.js");
    await fetchNewsForDailyReport();

    // 6개 카테고리 병렬 쿼리 — select가 6번 호출
    expect(db.select).toHaveBeenCalledTimes(6);
  });

  it("전체 12건(6카테고리×2건)이 조회되면 10건만 반환한다", async () => {
    const { db } = await import("@/db/client");
    const makeItems = (category: string): NewsItemForReport[] => [
      { title: `News1-${category}`, source: "reuters.com", url: `https://reuters.com/${category}-1`, category },
      { title: `News2-${category}`, source: "reuters.com", url: `https://reuters.com/${category}-2`, category },
    ];

    // 각 카테고리별 2건씩 반환
    const policyItems = makeItems("POLICY");
    const techItems = makeItems("TECHNOLOGY");
    const marketItems = makeItems("MARKET");
    const geoItems = makeItems("GEOPOLITICAL");
    const capexItems = makeItems("CAPEX");
    const otherItems = makeItems("OTHER");

    // 호출 순서대로 각 카테고리 결과 반환
    vi.mocked(db.select)
      .mockReturnValueOnce(makeDrizzleChain(policyItems) as never)
      .mockReturnValueOnce(makeDrizzleChain(techItems) as never)
      .mockReturnValueOnce(makeDrizzleChain(marketItems) as never)
      .mockReturnValueOnce(makeDrizzleChain(geoItems) as never)
      .mockReturnValueOnce(makeDrizzleChain(capexItems) as never)
      .mockReturnValueOnce(makeDrizzleChain(otherItems) as never);

    const { fetchNewsForDailyReport } = await import("../newsLoader.js");
    const result = await fetchNewsForDailyReport();

    // 최대 10건 제한
    expect(result.length).toBe(10);
  });

  it("반환 항목은 url, title, source, category를 포함한다", async () => {
    const { db } = await import("@/db/client");
    const mockItem: NewsItemForReport = {
      title: "AI Capex Surge",
      source: "bloomberg.com",
      url: "https://bloomberg.com/ai-capex",
      category: "CAPEX",
    };
    vi.mocked(db.select)
      .mockReturnValueOnce(makeDrizzleChain([mockItem]) as never)
      .mockReturnValue(makeDrizzleChain([]) as never);

    const { fetchNewsForDailyReport } = await import("../newsLoader.js");
    const result = await fetchNewsForDailyReport();

    expect(result[0]).toMatchObject({
      title: "AI Capex Surge",
      source: "bloomberg.com",
      url: "https://bloomberg.com/ai-capex",
      category: "CAPEX",
    });
  });
});
