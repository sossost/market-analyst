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

const BULL_BIAS_THRESHOLD = 0.7;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ReportType = "daily" | "weekly";

export interface ReportValidationInput {
  markdown: string;
  reportType?: ReportType;
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
  errors: string[],
): void {
  const substandardPhase: string[] = [];
  const substandardRs: string[] = [];

  for (const rec of recommendations) {
    const isPhase1 = rec.phase != null && rec.phase < MIN_PHASE;
    if (isPhase1) {
      // Phase 1 종목은 RS 수치와 무관하게 항상 ERROR — RS 경고를 중복 발행하지 않음
      substandardPhase.push(`${rec.symbol} (Phase ${rec.phase})`);
    } else if (rec.rsScore != null && rec.rsScore < MIN_RS_SCORE) {
      substandardRs.push(`${rec.symbol} (RS ${rec.rsScore})`);
    }
  }

  if (substandardPhase.length > 0) {
    errors.push(
      `Phase 1 종목 추천 감지: ${substandardPhase.join(", ")} — 추천 목록에서 제외하세요`,
    );
  }

  if (substandardRs.length > 0) {
    warnings.push(`RS 기준 미달 종목: ${substandardRs.join(", ")}`);
  }
}

/**
 * Phase 2 비율이 100%를 초과하는 패턴을 감지한다.
 * "Phase 2: 3520%" 같은 이중 변환 버그를 리포트 발송 전에 차단.
 */
const MAX_PHASE2_RATIO = 100;

function checkPhase2RatioRange(
  markdown: string,
  errors: string[],
): void {
  // 함수 내부에서 매번 생성하여 lastIndex 상태 오염 방지
  const pattern = /Phase\s*2[^:]*:\s*([\d,]+(?:\.\d+)?)\s*%/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(markdown)) !== null) {
    const rawValue = match[1].replace(/,/g, "");
    const value = Number(rawValue);
    if (Number.isFinite(value) && value > MAX_PHASE2_RATIO) {
      errors.push(
        `Phase 2 비율 이상값 감지: ${value}% (최대 100%). 이중 변환(×100) 버그 가능성. 원본: "${match[0]}"`,
      );
    }
  }
}

/**
 * 일간 리포트 MD에 필수 섹션이 포함되어 있는지 검증한다.
 * 필수 키워드: "시장 온도", "섹터 RS"(RS 랭킹 표), "시장 흐름"(종합 전망)
 */
type SectionSeverity = "error" | "warning";

const DAILY_REQUIRED_SECTIONS: ReadonlyArray<{
  keyword: string;
  label: string;
  severity: SectionSeverity;
}> = [
  { keyword: "시장 온도", label: "시장 온도 근거", severity: "error" },
  { keyword: "섹터 RS", label: "섹터 RS 랭킹 표", severity: "error" },
  { keyword: "시장 흐름", label: "시장 흐름 및 종합 전망", severity: "error" },
  { keyword: "섹터별 요약", label: "섹터별 요약", severity: "warning" },
  { keyword: "전일 대비", label: "전일 대비 변화 요약", severity: "warning" },
];

/** 특이종목이 없는 날 메시지만 전송하면 markdownContent가 빈 문자열. 실질적인 MD 파일 최소 길이. */
export const MIN_DAILY_MD_LENGTH = 500;

function checkDailySections(
  markdown: string,
  warnings: string[],
  errors: string[],
): void {
  if (markdown.length < MIN_DAILY_MD_LENGTH) {
    return;
  }

  const missingRequired: string[] = [];
  const missingOptional: string[] = [];

  for (const section of DAILY_REQUIRED_SECTIONS) {
    if (!markdown.includes(section.keyword)) {
      if (section.severity === "error") {
        missingRequired.push(section.label);
      } else {
        missingOptional.push(section.label);
      }
    }
  }

  if (missingRequired.length > 0) {
    errors.push(
      `일간 리포트 필수 섹션 누락: ${missingRequired.join(", ")}`,
    );
  }

  if (missingOptional.length > 0) {
    warnings.push(
      `일간 리포트 권장 섹션 누락: ${missingOptional.join(", ")}`,
    );
  }
}

/**
 * Phase 2 분류와 약세 서술이 같은 줄에 동시 등장하는 패턴을 감지한다.
 * 예: "SLDB Phase 2 — 바이오테크 약세 시작"
 *
 * @remarks 주간 리포트는 섹터 전체 흐름 서술에서 false positive 가능성이 높아 일간 전용으로 제한.
 */
const PHASE2_BEARISH_PATTERN = /Phase\s*2[^\n]*?(약세|하락세|부진|급락|손절)/gi;

function checkPhaseDescriptionConsistency(
  markdown: string,
  warnings: string[],
): void {
  const conflicts = [...markdown.matchAll(PHASE2_BEARISH_PATTERN)]
    .map((match) => match[0].slice(0, 80));

  if (conflicts.length > 0) {
    warnings.push(
      `Phase 2 분류 ↔ 약세 서술 모순 감지 (${conflicts.length}건). 서술 또는 Phase 분류를 수정하세요: ${conflicts.join(" | ")}`,
    );
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
    checkSubstandardStocks(input.recommendations, warnings, errors);
  }

  // D. Phase 2 비율 범위 검증 (이중 변환 방어)
  checkPhase2RatioRange(input.markdown, errors);

  // E. 일간 리포트 전용 검증 (필수 섹션 + Phase 분류 일관성)
  if (input.reportType === "daily") {
    checkDailySections(input.markdown, warnings, errors);
    checkPhaseDescriptionConsistency(input.markdown, warnings);
  }

  return {
    warnings,
    errors,
    isValid: errors.length === 0,
  };
}
