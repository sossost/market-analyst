// ---------------------------------------------------------------------------
// Report Validator — 리포트 발송 전 후처리 검증 레이어
// ---------------------------------------------------------------------------

const BULL_KEYWORDS = [
  "상승", "급등", "돌파", "신고가", "강세", "긍정", "호재", "성장", "개선", "확대",
] as const;

const BEAR_KEYWORDS = [
  "리스크", "주의", "경고", "위험", "하락", "약세", "손절", "변동성", "과열", "저항", "둔화", "부진",
] as const;

import { MIN_PHASE, MIN_RS_SCORE } from "@/agent/tools/validation";

const BULL_BIAS_THRESHOLD = 0.8;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReportValidationInput {
  markdown: string;
  leadingSectors?: string[];
  recommendations?: Array<{
    symbol: string;
    sector?: string;
    rsScore?: number;
    phase?: number;
  }>;
}

export interface ReportValidationResult {
  warnings: string[];
  errors: string[];
  isValid: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function countKeywords(text: string, keywords: readonly string[]): number {
  let count = 0;
  for (const kw of keywords) {
    if (text.includes(kw)) {
      count++;
    }
  }
  return count;
}

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

function checkRiskKeywords(
  markdown: string,
  warnings: string[],
  errors: string[],
): void {
  const bearCount = countKeywords(markdown, BEAR_KEYWORDS);
  const bullCount = countKeywords(markdown, BULL_KEYWORDS);

  if (bearCount === 0) {
    errors.push(
      "리포트에 리스크 관련 키워드가 전혀 없습니다. 리스크 섹션을 추가하세요.",
    );
  }

  const total = bullCount + bearCount;
  if (total > 0) {
    const bullRatio = bullCount / total;
    if (bullRatio > BULL_BIAS_THRESHOLD) {
      const pct = Math.round(bullRatio * 100);
      warnings.push(
        `Bull-bias ${pct}% 감지 (bull: ${bullCount}, bear: ${bearCount}). 균형 잡힌 분석이 필요합니다.`,
      );
    }
  }
}

function checkSectorAlignment(
  leadingSectors: string[],
  recommendations: Array<{ symbol: string; sector?: string }>,
  warnings: string[],
): void {
  const hasMatch = recommendations.some(
    (rec) =>
      rec.sector != null &&
      leadingSectors.some((ls) =>
        rec.sector!.toLowerCase().includes(ls.toLowerCase()),
      ),
  );

  if (!hasMatch) {
    const recSectors = recommendations
      .map((r) => r.sector)
      .filter((s): s is string => s != null);
    const uniqueRecSectors = [...new Set(recSectors)];
    warnings.push(
      `섹터-종목 불일치: 주도섹터 [${leadingSectors.join(", ")}]와 추천 종목 섹터 [${uniqueRecSectors.join(", ")}]가 겹치지 않습니다.`,
    );
  }
}

function checkSubstandardStocks(
  recommendations: Array<{
    symbol: string;
    rsScore?: number;
    phase?: number;
  }>,
  warnings: string[],
): void {
  const substandard: string[] = [];

  for (const rec of recommendations) {
    const failReasons: string[] = [];

    if (rec.phase != null && rec.phase < MIN_PHASE) {
      failReasons.push(`Phase ${rec.phase}`);
    }
    if (rec.rsScore != null && rec.rsScore < MIN_RS_SCORE) {
      failReasons.push(`RS ${rec.rsScore}`);
    }

    if (failReasons.length > 0) {
      substandard.push(`${rec.symbol} (${failReasons.join(", ")})`);
    }
  }

  if (substandard.length > 0) {
    warnings.push(`기준 미달 종목: ${substandard.join(", ")}`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export function validateReport(
  input: ReportValidationInput,
): ReportValidationResult {
  const warnings: string[] = [];
  const errors: string[] = [];

  // A. 리스크 키워드 + bull-bias 체크
  checkRiskKeywords(input.markdown, warnings, errors);

  // B. 섹터-종목 정합성 체크
  if (input.leadingSectors != null && input.recommendations != null) {
    if (input.leadingSectors.length > 0 && input.recommendations.length > 0) {
      checkSectorAlignment(input.leadingSectors, input.recommendations, warnings);
    }
  }

  // C. 기준 미달 종목 태깅
  if (input.recommendations != null && input.recommendations.length > 0) {
    checkSubstandardStocks(input.recommendations, warnings);
  }

  return {
    warnings,
    errors,
    isValid: errors.length === 0,
  };
}
