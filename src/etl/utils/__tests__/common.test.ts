import { describe, it, expect } from "vitest";
import { isValidTicker } from "../common";

describe("isValidTicker", () => {
  // ── 정상 티커 (통과해야 함) ──────────────────────────────────────────────
  it.each([
    ["AAPL", "일반 4글자"],
    ["MSFT", "일반 4글자"],
    ["A", "1글자 티커"],
    ["MU", "2글자 U로 끝남 (Micron)"],
    ["VU", "2글자 U로 끝남"],
    ["W", "1글자 W (Wayfair)"],
    ["AW", "2글자 W로 끝남"],
    ["MW", "2글자 W로 끝남"],
    ["TSU", "3글자 U로 끝남"],
    ["AAW", "3글자 W로 끝남"],
    ["GOOG", "일반 4글자"],
    ["NVDA", "일반 4글자"],
  ])("allows %s (%s)", (symbol) => {
    expect(isValidTicker(symbol)).toBe(true);
  });

  // ── SPAC 유닛 (U 접미사, 4글자 이상 → 차단) ────────────────────────────
  it.each([
    ["IPOFU", "5글자 SPAC 유닛"],
    ["SPKU", "4글자 SPAC 유닛"],
    ["ABCDU", "5글자 SPAC 유닛"],
  ])("rejects SPAC unit %s (%s)", (symbol) => {
    expect(isValidTicker(symbol)).toBe(false);
  });

  // ── 워런트 (W 접미사, 4글자 이상 → 차단) ────────────────────────────────
  it.each([
    ["SPACW", "5글자 워런트"],
    ["IPOW", "4글자 워런트"],
    ["ABCDW", "5글자 워런트"],
  ])("rejects warrant %s (%s)", (symbol) => {
    expect(isValidTicker(symbol)).toBe(false);
  });

  // ── 워런트 WS 접미사 ────────────────────────────────────────────────────
  it.each([
    ["SPACWS", "워런트 WS — 6글자이지만 regex 5자 제한으로 차단"],
    ["ABWS", "4글자 WS 워런트"],
  ])("rejects WS warrant %s (%s)", (symbol) => {
    expect(isValidTicker(symbol)).toBe(false);
  });

  // ── X 접미사 (특수 주식 클래스) ──────────────────────────────────────────
  it.each([
    ["FUNDX", "5글자 X 접미사"],
    ["GOOGX", "5글자 X 접미사"],
  ])("rejects X-suffix %s (%s)", (symbol) => {
    expect(isValidTicker(symbol)).toBe(false);
  });

  // ── 형식 위반 ──────────────────────────────────────────────────────────
  it.each([
    ["aapl", "소문자"],
    ["BRK.B", "점 포함 (외국 상장)"],
    ["123", "숫자"],
    ["", "빈 문자열"],
    ["ABCDEF", "6글자 초과"],
    ["A1B", "숫자 포함"],
  ])("rejects invalid format %s (%s)", (symbol) => {
    expect(isValidTicker(symbol)).toBe(false);
  });
});
