import { describe, it, expect } from "vitest";
import { calculateRecentVolSurge } from "@/etl/jobs/build-stock-phases";

describe("calculateRecentVolSurge", () => {
  it("최근 5거래일 중 1일이라도 vol_ratio >= 1.5 이면 true 반환", () => {
    // 5일 중 마지막 날(index 4)이 서지
    const volumes = [1000, 1000, 1000, 1000, 1500];
    expect(calculateRecentVolSurge(volumes, 1000)).toBe(true);
  });

  it("최근 5거래일 중 첫 날(가장 최신)이 서지이면 true 반환", () => {
    const volumes = [1500, 1000, 1000, 1000, 1000];
    expect(calculateRecentVolSurge(volumes, 1000)).toBe(true);
  });

  it("5거래일 내 모든 날이 서지 미만이면 false 반환", () => {
    const volumes = [1400, 1400, 1400, 1400, 1400]; // 1400/1000 = 1.4 < 1.5
    expect(calculateRecentVolSurge(volumes, 1000)).toBe(false);
  });

  it("정확히 1.5 이면 true 반환 (경계값)", () => {
    const volumes = [1500]; // 1500/1000 = 1.5 >= 1.5
    expect(calculateRecentVolSurge(volumes, 1000)).toBe(true);
  });

  it("5일보다 적은 데이터가 있어도 정상 동작", () => {
    // slice(0, 5)는 3개 이하 배열도 정상 처리
    const volumes = [1600, 900]; // 1600/1000 = 1.6 → true
    expect(calculateRecentVolSurge(volumes, 1000)).toBe(true);
  });

  it("6번째 이후 데이터는 lookback 범위 밖이므로 무시", () => {
    // index 0~4 는 모두 서지 미만, index 5는 서지 이상이지만 무시
    const volumes = [1400, 1400, 1400, 1400, 1400, 2000];
    expect(calculateRecentVolSurge(volumes, 1000)).toBe(false);
  });

  it("volMa30이 null이면 false 반환", () => {
    const volumes = [2000, 2000, 2000];
    expect(calculateRecentVolSurge(volumes, null)).toBe(false);
  });

  it("volMa30이 0이면 false 반환 (division guard)", () => {
    const volumes = [2000, 2000, 2000];
    expect(calculateRecentVolSurge(volumes, 0)).toBe(false);
  });

  it("빈 배열이면 false 반환", () => {
    expect(calculateRecentVolSurge([], 1000)).toBe(false);
  });
});
