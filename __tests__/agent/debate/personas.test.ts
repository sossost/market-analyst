import { describe, it, expect } from "vitest";
import {
  loadExpertPersonas,
  loadModeratorPersona,
  loadAllPersonas,
  getAvailableAgentFiles,
} from "@/debate/personas.js";
import type { AgentPersona } from "../../../src/types/debate.js";

describe("personas", () => {
  describe("loadExpertPersonas", () => {
    it("loads exactly 4 expert personas", () => {
      const experts = loadExpertPersonas();
      expect(experts).toHaveLength(4);
    });

    it("returns all expected persona names", () => {
      const experts = loadExpertPersonas();
      const names = experts.map((e) => e.name);
      expect(names).toEqual(["macro", "tech", "geopolitics", "sentiment"]);
    });

    it("each persona has non-empty systemPrompt without frontmatter", () => {
      const experts = loadExpertPersonas();
      for (const persona of experts) {
        expect(persona.systemPrompt.length).toBeGreaterThan(100);
        expect(persona.systemPrompt).not.toContain("---");
        expect(persona.systemPrompt).not.toContain("tools:");
      }
    });

    it("each persona has non-empty description and model", () => {
      const experts = loadExpertPersonas();
      for (const persona of experts) {
        expect(persona.description).toBeTruthy();
        expect(persona.model.length).toBeGreaterThan(0);
      }
    });

    it("골 기여도 높은 테크·매크로는 opus, 보조 역할은 외부 모델", () => {
      const experts = loadExpertPersonas();
      const macro = experts.find((e) => e.name === "macro");
      const tech = experts.find((e) => e.name === "tech");
      const sentiment = experts.find((e) => e.name === "sentiment");
      const geopolitics = experts.find((e) => e.name === "geopolitics");
      expect(tech?.model).toBe("opus");
      expect(macro?.model).toBe("opus");
      expect(sentiment?.model).toBe("gpt-4o");
      expect(geopolitics?.model).toBe("gemini-2.5-flash");
    });
  });

  describe("loadModeratorPersona", () => {
    it("loads moderator with correct name", () => {
      const mod = loadModeratorPersona();
      expect(mod.name).toBe("moderator");
    });

    it("moderator systemPrompt does not contain frontmatter", () => {
      const mod = loadModeratorPersona();
      expect(mod.systemPrompt).not.toContain("---");
      expect(mod.systemPrompt.length).toBeGreaterThan(100);
    });
  });

  describe("loadAllPersonas", () => {
    it("loads 5 personas total (4 experts + 1 moderator)", () => {
      const all = loadAllPersonas();
      expect(all).toHaveLength(5);
      expect(all[4].name).toBe("moderator");
    });
  });

  describe("getAvailableAgentFiles", () => {
    it("returns at least 5 .md files", () => {
      const files = getAvailableAgentFiles();
      expect(files.length).toBeGreaterThanOrEqual(5);
      for (const file of files) {
        expect(file).toMatch(/\.md$/);
      }
    });
  });
});
