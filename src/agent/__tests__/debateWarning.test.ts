import { describe, it, expect } from "vitest";
import { buildAgentErrorWarning } from "../run-debate-agent.js";

describe("buildAgentErrorWarning", () => {
  it("단일 실패 애널리스트 경고 메시지를 생성한다", () => {
    const result = buildAgentErrorWarning("2026-04-01", [
      { persona: "geopolitics", round: 1, error: "Failed to produce output" },
    ]);

    expect(result).toContain("⚠️ **[토론 품질 경고]** 2026-04-01");
    expect(result).toContain("애널리스트 1명 실패");
    expect(result).toContain("- geopolitics (Round 1): Failed to produce output");
    expect(result).toContain("토론은 나머지 애널리스트로 완료됨");
  });

  it("복수 실패 애널리스트를 모두 나열한다", () => {
    const result = buildAgentErrorWarning("2026-04-01", [
      { persona: "geopolitics", round: 1, error: "Failed to produce output" },
      { persona: "sentiment", round: 2, error: "Timeout exceeded" },
    ]);

    expect(result).toContain("애널리스트 2명 실패");
    expect(result).toContain("- geopolitics (Round 1): Failed to produce output");
    expect(result).toContain("- sentiment (Round 2): Timeout exceeded");
  });

  it("Round 번호가 정확히 표시된다", () => {
    const result = buildAgentErrorWarning("2026-04-01", [
      { persona: "macro", round: 2, error: "error" },
    ]);

    expect(result).toContain("Round 2");
    expect(result).not.toContain("Round 1");
  });

  it("모든 persona 타입을 올바르게 표시한다", () => {
    const result = buildAgentErrorWarning("2026-04-01", [
      { persona: "macro", round: 1, error: "err1" },
      { persona: "tech", round: 1, error: "err2" },
      { persona: "geopolitics", round: 1, error: "err3" },
      { persona: "sentiment", round: 1, error: "err4" },
    ]);

    expect(result).toContain("애널리스트 4명 실패");
    expect(result).toContain("macro");
    expect(result).toContain("tech");
    expect(result).toContain("geopolitics");
    expect(result).toContain("sentiment");
  });

  it("날짜가 메시지에 포함된다", () => {
    const result = buildAgentErrorWarning("2026-12-31", [
      { persona: "macro", round: 1, error: "err" },
    ]);

    expect(result).toContain("2026-12-31");
  });
});
