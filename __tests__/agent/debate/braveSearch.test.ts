import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { executeDebateTool, DEBATE_TOOLS } from "@/debate/braveSearch.js";

describe("braveSearch", () => {
  const originalEnv = process.env.BRAVE_API_KEY;

  beforeEach(() => {
    process.env.BRAVE_API_KEY = "test-key";
  });

  afterEach(() => {
    process.env.BRAVE_API_KEY = originalEnv;
    vi.restoreAllMocks();
  });

  describe("DEBATE_TOOLS", () => {
    it("defines web_search and news_search tools", () => {
      expect(DEBATE_TOOLS).toHaveLength(2);
      expect(DEBATE_TOOLS[0].name).toBe("web_search");
      expect(DEBATE_TOOLS[1].name).toBe("news_search");
    });

    it("each tool has valid input schema", () => {
      for (const tool of DEBATE_TOOLS) {
        expect(tool.input_schema.type).toBe("object");
        expect(tool.input_schema.required).toContain("query");
      }
    });
  });

  describe("executeDebateTool", () => {
    it("returns error for empty query", async () => {
      const result = await executeDebateTool("web_search", { query: "" });
      expect(JSON.parse(result)).toEqual({ error: "Empty query" });
    });

    it("returns error for unknown tool", async () => {
      const result = await executeDebateTool("unknown_tool", { query: "test" });
      expect(JSON.parse(result)).toEqual({ error: "Unknown tool: unknown_tool" });
    });

    it("returns error when BRAVE_API_KEY is not set", async () => {
      process.env.BRAVE_API_KEY = "";
      const result = await executeDebateTool("web_search", { query: "test" });
      const parsed = JSON.parse(result);
      expect(parsed.error).toContain("BRAVE_API_KEY");
    });

    it("calls Brave web search API and returns XML-wrapped results", async () => {
      const mockResponse = {
        ok: true,
        json: () =>
          Promise.resolve({
            web: {
              results: [
                {
                  title: "Fed Rate Decision",
                  url: "https://example.com/fed",
                  description: "Fed holds rates steady",
                  meta_url: { hostname: "example.com" },
                },
              ],
            },
          }),
      };
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(mockResponse as Response);

      const result = await executeDebateTool("web_search", { query: "fed rate decision 2026" });

      expect(result).toContain("<search-results");
      expect(result).toContain("</search-results>");
      expect(result).toContain('trust="external"');

      const jsonMatch = result.match(/<search-results[^>]*>\n([\s\S]*?)\n<\/search-results>/);
      const parsed = JSON.parse(jsonMatch![1]);
      expect(parsed.query).toBe("fed rate decision 2026");
      expect(parsed.results).toHaveLength(1);
      expect(parsed.results[0].title).toBe("Fed Rate Decision");
    });

    it("calls Brave news search API with XML wrapping", async () => {
      const mockResponse = {
        ok: true,
        json: () =>
          Promise.resolve({
            results: [
              {
                title: "AI Capex Surge",
                url: "https://news.example.com/ai",
                description: "Tech giants increase AI spending",
                meta_url: { hostname: "news.example.com" },
                age: "2 hours ago",
              },
            ],
          }),
      };
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(mockResponse as Response);

      const result = await executeDebateTool("news_search", { query: "AI capex 2026" });

      expect(result).toContain("<search-results");
      const jsonMatch = result.match(/<search-results[^>]*>\n([\s\S]*?)\n<\/search-results>/);
      const parsed = JSON.parse(jsonMatch![1]);
      expect(parsed.results).toHaveLength(1);
      expect(parsed.results[0].title).toBe("AI Capex Surge");
      expect(parsed.results[0].age).toBe("2 hours ago");
    });

    it("handles API failure gracefully", async () => {
      const mockResponse = {
        ok: false,
        status: 429,
      };
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(mockResponse as Response);

      const result = await executeDebateTool("web_search", { query: "test" });
      const parsed = JSON.parse(result);
      expect(parsed.error).toContain("429");
      expect(parsed.results).toEqual([]);
    });

    it("handles network error gracefully", async () => {
      vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("Network timeout"));

      const result = await executeDebateTool("web_search", { query: "test" });
      const parsed = JSON.parse(result);
      expect(parsed.error).toContain("Network timeout");
    });
  });
});
