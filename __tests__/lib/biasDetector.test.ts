import { describe, it, expect } from "vitest";
import { detectBullBias } from "@/lib/biasDetector";

describe("detectBullBias", () => {
  it("순수 bull 원칙 5개 → bullRatio 1.0, isSkewed true", () => {
    const principles = [
      "시장 상승 추세 지속",
      "기술주 돌파 패턴 반복",
      "강세장 진입 신호",
      "긍정적 실적 반응",
      "반등 패턴 확인",
    ];

    const result = detectBullBias(principles);

    expect(result.bullCount).toBe(5);
    expect(result.bearCount).toBe(0);
    expect(result.bullRatio).toBe(1.0);
    expect(result.isSkewed).toBe(true);
    expect(result.totalLearnings).toBe(5);
  });

  it("순수 bear 원칙 5개 → bullRatio 0.0, isSkewed false", () => {
    const principles = [
      "시장 하락 압력 증가",
      "약세 신호 감지",
      "부정적 매크로 환경",
      "조정 가능성 높음",
      "위축된 소비 지표",
    ];

    const result = detectBullBias(principles);

    expect(result.bullCount).toBe(0);
    expect(result.bearCount).toBe(5);
    expect(result.bullRatio).toBe(0.0);
    expect(result.isSkewed).toBe(false);
  });

  it("혼합 원칙 → 적절한 비율 계산", () => {
    const principles = [
      "상승 모멘텀 유지",
      "하락 리스크 존재",
      "강세 전환 가능",
      "둔화 우려",
    ];

    const result = detectBullBias(principles);

    expect(result.bullCount).toBe(2);
    expect(result.bearCount).toBe(2); // "하락 리스크 존재" → 1, "둔화 우려" → 1
    expect(result.bullRatio).toBe(2 / 4);
    expect(result.isSkewed).toBe(false);
  });

  it("빈 배열 → bullRatio 0.5, isSkewed false", () => {
    const result = detectBullBias([]);

    expect(result.bullCount).toBe(0);
    expect(result.bearCount).toBe(0);
    expect(result.totalLearnings).toBe(0);
    expect(result.bullRatio).toBe(0.5);
    expect(result.isSkewed).toBe(false);
  });

  it("키워드 없는 원칙 → 카운트에 포함 안 됨", () => {
    const principles = [
      "기술적 지표 확인 필요",
      "데이터 수집 완료",
      "분석 모델 업데이트",
    ];

    const result = detectBullBias(principles);

    expect(result.bullCount).toBe(0);
    expect(result.bearCount).toBe(0);
    expect(result.totalLearnings).toBe(3);
    expect(result.bullRatio).toBe(0.5);
    expect(result.isSkewed).toBe(false);
  });

  it("bull/bear 둘 다 포함하는 원칙 → 양쪽 모두 +1", () => {
    const principles = [
      "상승 후 조정 가능성",
    ];

    const result = detectBullBias(principles);

    expect(result.bullCount).toBe(1);
    expect(result.bearCount).toBe(1);
    expect(result.bullRatio).toBe(0.5);
    expect(result.isSkewed).toBe(false);
  });

  it("임계값 경계 (bullRatio = 0.8) → isSkewed false", () => {
    // 4 bull, 1 bear → ratio = 0.8
    const principles = [
      "상승 추세",
      "강세 확인",
      "돌파 패턴",
      "반등 신호",
      "하락 리스크",
    ];

    const result = detectBullBias(principles);

    expect(result.bullCount).toBe(4);
    expect(result.bearCount).toBe(1);
    expect(result.bullRatio).toBe(0.8);
    expect(result.isSkewed).toBe(false); // > 0.8 이어야 true, 0.8은 false
  });

  it("임계값 초과 (bullRatio > 0.8) → isSkewed true", () => {
    // 5 bull, 1 bear → ratio = 5/6 ≈ 0.833
    const principles = [
      "상승 추세",
      "강세 확인",
      "돌파 패턴",
      "반등 신호",
      "성장 가속",
      "하락 리스크",
    ];

    const result = detectBullBias(principles);

    expect(result.bullCount).toBe(5);
    expect(result.bearCount).toBe(1);
    expect(result.bullRatio).toBeCloseTo(5 / 6);
    expect(result.isSkewed).toBe(true);
  });
});
