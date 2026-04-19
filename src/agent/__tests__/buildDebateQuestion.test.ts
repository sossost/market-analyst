import { describe, it, expect } from "vitest";
import { buildDebateQuestion } from "../run-debate-agent.js";

describe("buildDebateQuestion", () => {
  describe("기본 동작", () => {
    it("날짜가 질문 본문에 포함된다", () => {
      const result = buildDebateQuestion("2026-04-18");
      expect(result).toContain("오늘은 2026-04-18입니다.");
    });

    it("narrativeChainContext 기본값이 빈 문자열이어도 동작한다", () => {
      expect(() => buildDebateQuestion("2026-04-18")).not.toThrow();
    });

    it("병목 생애주기 판단 섹션이 포함된다", () => {
      const result = buildDebateQuestion("2026-04-18");
      expect(result).toContain("## 병목 생애주기 판단 (필수)");
    });
  });

  describe("공급망 블록 조건부 삽입", () => {
    it("활성 국면 컨텍스트가 없으면 공급망 연역 분석 블록을 삽입하지 않는다", () => {
      const result = buildDebateQuestion("2026-04-18", "");
      expect(result).not.toContain("## 공급망 연역 분석");
    });

    it("활성 국면 컨텍스트가 있으면 공급망 연역 분석 블록을 삽입한다", () => {
      const ctx = "## 현재 활성 국면 (Meta-Regime)\n\n### AI 인프라 사이클\n- 전파 유형: 공급망 전파";
      const result = buildDebateQuestion("2026-04-18", ctx);
      expect(result).toContain("## 공급망 연역 분석");
    });

    it("공급망 블록 삽입 시 마크다운 형식이 올바른지 확인", () => {
      const ctx = "## 현재 활성 국면 (Meta-Regime)\n...";
      const result = buildDebateQuestion("2026-04-18", ctx);
      // 블록이 "\n\n## 공급망 연역 분석"으로 시작하여 올바른 마크다운 구조 유지
      expect(result).toContain("\n\n## 공급망 연역 분석");
    });

    it('"## 현재 활성 국면" 헤더가 없는 컨텍스트는 블록 미삽입', () => {
      // formatMetaRegimesForPrompt()는 국면이 없으면 빈 문자열을 반환한다.
      // 따라서 이 케이스는 실제로 발생하지 않지만 방어 코드로도 정상 동작해야 한다.
      const ctxWithoutHeader = "서사 체인 데이터는 있지만 활성 국면 헤더 없음\n\n병목 A: ACTIVE";
      const result = buildDebateQuestion("2026-04-18", ctxWithoutHeader);
      expect(result).not.toContain("## 공급망 연역 분석");
    });

    it("공급망 블록에 N+1 병목 예측 항목이 포함된다", () => {
      const ctx = "## 현재 활성 국면 (Meta-Regime)\n\n### AI 인프라 사이클";
      const result = buildDebateQuestion("2026-04-18", ctx);
      expect(result).toContain("N+1 병목 예측");
    });

    it("공급망 블록에 수혜 섹터/종목 항목이 포함된다", () => {
      const ctx = "## 현재 활성 국면 (Meta-Regime)\n\n### AI 인프라 사이클";
      const result = buildDebateQuestion("2026-04-18", ctx);
      expect(result).toContain("수혜 섹터/종목");
    });
  });
});
