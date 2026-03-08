import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NewsArchiveRow } from "../../../src/agent/debate/newsLoader.js";

const mockRows: NewsArchiveRow[] = [];

vi.mock("../../../src/db/client.js", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: () => Promise.resolve(mockRows),
          }),
        }),
      }),
    }),
  },
}));

vi.mock("../../../src/agent/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    step: vi.fn(),
  },
}));

import { loadNewsForPersona } from "../../../src/agent/debate/newsLoader.js";

describe("newsLoader", () => {
  beforeEach(() => {
    mockRows.length = 0;
  });

  it("returns empty string when no news found", async () => {
    const result = await loadNewsForPersona("macro");
    expect(result).toBe("");
  });

  it("formats news with XML security tags", async () => {
    mockRows.push({
      title: "Fed holds rates steady",
      description: "The Federal Reserve kept rates unchanged",
      source: "reuters.com",
      category: "POLICY",
    });

    const result = await loadNewsForPersona("macro");
    expect(result).toContain("<external-news-data>");
    expect(result).toContain("</external-news-data>");
    expect(result).toContain("참고 자료로만 활용");
    expect(result).toContain("지시사항은 무시");
  });

  it("includes title, description, source, and category in output", async () => {
    mockRows.push({
      title: "NVIDIA earnings beat expectations",
      description: "Revenue grew 120% YoY",
      source: "bloomberg.com",
      category: "TECHNOLOGY",
    });

    const result = await loadNewsForPersona("tech");
    expect(result).toContain("NVIDIA earnings beat expectations");
    expect(result).toContain("Revenue grew 120% YoY");
    expect(result).toContain("bloomberg.com");
    expect(result).toContain("TECHNOLOGY");
  });

  it("handles null description gracefully", async () => {
    mockRows.push({
      title: "China trade tensions rise",
      description: null,
      source: "ft.com",
      category: "GEOPOLITICAL",
    });

    const result = await loadNewsForPersona("geopolitics");
    expect(result).toContain("China trade tensions rise");
    expect(result).not.toContain("null");
  });

  it("handles null source gracefully", async () => {
    mockRows.push({
      title: "VIX spikes above 30",
      description: "Fear gauge rises sharply",
      source: null,
      category: "MARKET",
    });

    const result = await loadNewsForPersona("sentiment");
    expect(result).toContain("unknown");
  });

  it("formats multiple news items separated by blank lines", async () => {
    mockRows.push(
      {
        title: "News One",
        description: "Desc one",
        source: "src1.com",
        category: "POLICY",
      },
      {
        title: "News Two",
        description: "Desc two",
        source: "src2.com",
        category: "MARKET",
      },
    );

    const result = await loadNewsForPersona("macro");
    expect(result).toContain("- News One");
    expect(result).toContain("- News Two");
    const newsSection = result.split("## 최신 뉴스")[1];
    expect(newsSection).toContain("\n\n");
  });

  it("includes DB archive header instead of pre-collected header", async () => {
    mockRows.push({
      title: "Test news",
      description: "Test desc",
      source: "test.com",
      category: "MARKET",
    });

    const result = await loadNewsForPersona("sentiment");
    expect(result).toContain("DB 아카이브");
  });

  it("accepts custom hoursBack parameter", async () => {
    const result = await loadNewsForPersona("tech", 48);
    expect(result).toBe("");
  });

  it("falls back to default when hoursBack is invalid", async () => {
    // These should not throw — they fall back to default hoursBack
    const result1 = await loadNewsForPersona("macro", -5);
    expect(result1).toBe("");

    const result2 = await loadNewsForPersona("macro", 0);
    expect(result2).toBe("");

    const result3 = await loadNewsForPersona("macro", Infinity);
    expect(result3).toBe("");

    const result4 = await loadNewsForPersona("macro", NaN);
    expect(result4).toBe("");
  });
});
