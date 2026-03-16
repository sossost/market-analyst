/**
 * captureLogicAuditor 순수 함수 단위 테스트
 */

import { describe, it, expect } from "vitest";
import {
  normalizePriority,
  parseInsights,
} from "../reviewers/captureLogicAuditor.js";

describe("normalizePriority", () => {
  it("P1 문자열을 P1로 반환한다", () => {
    expect(normalizePriority("P1")).toBe("P1");
  });

  it("P2 문자열을 P2로 반환한다", () => {
    expect(normalizePriority("P2")).toBe("P2");
  });

  it("P3 문자열을 P3로 반환한다", () => {
    expect(normalizePriority("P3")).toBe("P3");
  });

  it("소문자 p1을 P1로 정규화한다", () => {
    expect(normalizePriority("p1")).toBe("P1");
  });

  it("소문자 p2를 P2로 정규화한다", () => {
    expect(normalizePriority("p2")).toBe("P2");
  });

  it("인식 불가 값은 P3로 폴백한다", () => {
    expect(normalizePriority("CRITICAL")).toBe("P3");
    expect(normalizePriority("")).toBe("P3");
    expect(normalizePriority("P4")).toBe("P3");
  });
});

describe("parseInsights", () => {
  it("올바른 JSON 배열에서 인사이트를 파싱한다", () => {
    const content = JSON.stringify([
      {
        title: "phase-detection.ts MA150 임계값 과소",
        body: "## 문제\n설명",
        priority: "P1",
      },
    ]);
    const insights = parseInsights(content);
    expect(insights).toHaveLength(1);
    expect(insights[0]?.title).toBe("phase-detection.ts MA150 임계값 과소");
    expect(insights[0]?.priority).toBe("P1");
  });

  it("JSON 외 텍스트가 섞인 응답에서 JSON 배열을 추출한다", () => {
    const content = `분석 결과입니다:\n${JSON.stringify([
      { title: "제목", body: "내용", priority: "P2" },
    ])}\n이상입니다.`;
    const insights = parseInsights(content);
    expect(insights).toHaveLength(1);
  });

  it("JSON 배열이 없는 경우 빈 배열을 반환한다", () => {
    expect(parseInsights("JSON 없는 텍스트")).toHaveLength(0);
  });

  it("유효하지 않은 JSON에 대해 빈 배열을 반환한다", () => {
    expect(parseInsights("[{invalid}]")).toHaveLength(0);
  });

  it("title이 없는 항목을 필터링한다", () => {
    const content = JSON.stringify([
      { body: "내용만 있음", priority: "P1" },
      { title: "정상 항목", body: "내용", priority: "P2" },
    ]);
    const insights = parseInsights(content);
    expect(insights).toHaveLength(1);
    expect(insights[0]?.title).toBe("정상 항목");
  });

  it("body가 없는 항목을 필터링한다", () => {
    const content = JSON.stringify([
      { title: "제목만 있음", priority: "P1" },
    ]);
    const insights = parseInsights(content);
    expect(insights).toHaveLength(0);
  });

  it("여러 인사이트를 순서대로 반환한다", () => {
    const content = JSON.stringify([
      { title: "첫 번째", body: "내용1", priority: "P1" },
      { title: "두 번째", body: "내용2", priority: "P2" },
      { title: "세 번째", body: "내용3", priority: "P3" },
    ]);
    const insights = parseInsights(content);
    expect(insights).toHaveLength(3);
    expect(insights[0]?.title).toBe("첫 번째");
    expect(insights[2]?.title).toBe("세 번째");
  });
});
