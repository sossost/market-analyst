/**
 * issueCreator 순수 함수 단위 테스트
 */

import { describe, it, expect } from "vitest";
import { buildIssueTitle } from "../issueCreator.js";
import type { Insight } from "../types.js";

function makeInsight(overrides: Partial<Insight> = {}): Insight {
  return {
    title: "phase-detection.ts MA150 기울기 임계값 낮음",
    body: "## 문제\n임계값이 너무 낮아 오판 발생",
    focus: "capture-logic",
    priority: "P1",
    reviewerName: "captureLogicAuditor",
    ...overrides,
  };
}

describe("buildIssueTitle", () => {
  it("[strategic-review/{focus}] {title} 형식으로 이슈 제목을 생성한다", () => {
    const insight = makeInsight();
    expect(buildIssueTitle(insight)).toBe(
      "[strategic-review/capture-logic] phase-detection.ts MA150 기울기 임계값 낮음",
    );
  });

  it("learning-loop 포커스로 올바른 제목을 생성한다", () => {
    const insight = makeInsight({
      title: "hit_rate 0.3 미만 학습 항목 3개 감지",
      focus: "learning-loop",
    });
    expect(buildIssueTitle(insight)).toBe(
      "[strategic-review/learning-loop] hit_rate 0.3 미만 학습 항목 3개 감지",
    );
  });

  it("특수문자가 포함된 제목도 그대로 포함한다", () => {
    const insight = makeInsight({
      title: "getRisingRS.ts: RS 30~60 범위 조건 누락",
      focus: "capture-logic",
    });
    expect(buildIssueTitle(insight)).toBe(
      "[strategic-review/capture-logic] getRisingRS.ts: RS 30~60 범위 조건 누락",
    );
  });
});
