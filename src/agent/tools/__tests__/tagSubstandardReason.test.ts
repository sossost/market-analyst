import { describe, it, expect } from "vitest";
import { tagSubstandardReason } from "../saveRecommendations";

describe("tagSubstandardReason", () => {
  it("Phase 1 종목은 [기준 미달] 접두사를 추가한다", () => {
    const result = tagSubstandardReason("NVIDIA 파트너십 확대", 1, 85);

    expect(result).toBe("[기준 미달] NVIDIA 파트너십 확대");
  });

  it("RS 50인 종목은 [기준 미달] 접두사를 추가한다", () => {
    const result = tagSubstandardReason("성장 기대", 2, 50);

    expect(result).toBe("[기준 미달] 성장 기대");
  });

  it("Phase 1 + RS 50 (둘 다 미달) 종목도 접두사 한 번만 추가한다", () => {
    const result = tagSubstandardReason("복합 미달", 1, 50);

    expect(result).toBe("[기준 미달] 복합 미달");
  });

  it("정상 종목(Phase 2, RS 85)은 reason을 변경하지 않는다", () => {
    const result = tagSubstandardReason("정상 추천 사유", 2, 85);

    expect(result).toBe("정상 추천 사유");
  });

  it("Phase 2, RS 60 (경계값)은 기준 충족으로 변경하지 않는다", () => {
    const result = tagSubstandardReason("경계값 종목", 2, 60);

    expect(result).toBe("경계값 종목");
  });

  it("Phase 3, RS 99 (높은 단계)은 변경하지 않는다", () => {
    const result = tagSubstandardReason("고단계 종목", 3, 99);

    expect(result).toBe("고단계 종목");
  });

  it("이미 [기준 미달] 태그가 있으면 중복 추가하지 않는다", () => {
    const result = tagSubstandardReason("[기준 미달] 기존 사유", 1, 50);

    expect(result).toBe("[기준 미달] 기존 사유");
  });

  it("reason이 null이고 기준 미달이면 기본 메시지를 반환한다", () => {
    const result = tagSubstandardReason(null, 1, 85);

    expect(result).toBe("[기준 미달] 사유 미기재");
  });

  it("reason이 undefined이고 기준 미달이면 기본 메시지를 반환한다", () => {
    const result = tagSubstandardReason(undefined, 1, 85);

    expect(result).toBe("[기준 미달] 사유 미기재");
  });

  it("reason이 빈 문자열이고 기준 미달이면 기본 메시지를 반환한다", () => {
    const result = tagSubstandardReason("", 1, 85);

    expect(result).toBe("[기준 미달] 사유 미기재");
  });

  it("reason이 null이고 기준 충족이면 null을 반환한다", () => {
    const result = tagSubstandardReason(null, 2, 85);

    expect(result).toBeNull();
  });

  it("reason이 undefined이고 기준 충족이면 null을 반환한다", () => {
    const result = tagSubstandardReason(undefined, 3, 70);

    expect(result).toBeNull();
  });

  it("phase가 null이고 RS 미달이면 태깅한다", () => {
    const result = tagSubstandardReason("RS만 미달", null, 30);

    expect(result).toBe("[기준 미달] RS만 미달");
  });

  it("rsScore가 null이고 phase 미달이면 태깅한다", () => {
    const result = tagSubstandardReason("phase만 미달", 1, null);

    expect(result).toBe("[기준 미달] phase만 미달");
  });

  it("phase와 rsScore 모두 null이면 변경하지 않는다", () => {
    const result = tagSubstandardReason("둘 다 null", null, null);

    expect(result).toBe("둘 다 null");
  });

  it("RS 59 (경계값 미달)은 태깅한다", () => {
    const result = tagSubstandardReason("RS 경계", 2, 59);

    expect(result).toBe("[기준 미달] RS 경계");
  });
});
