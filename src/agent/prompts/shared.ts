/**
 * 프롬프트 공유 유틸리티.
 * daily.ts, weekly.ts에서 import하여 사용한다.
 */

import {
  buildAdvisoryFeedback,
  buildMandatoryRules,
  getVerdictStats,
  loadRecentFeedback,
  type FeedbackReportType,
} from "@/lib/reviewFeedback";

/**
 * 피드백을 프롬프트에 계층적으로 주입한다.
 * - 반복 패턴(2회+): 규칙 섹션 앞에 "필수 규칙"으로 삽입 (높은 우선순위)
 * - 비반복 피드백: 프롬프트 끝에 참고사항으로 추가
 * - reportType: 지정 시 해당 리포트 타입의 피드백만 로드
 */
export function injectFeedbackLayers(
  base: string,
  reportType?: FeedbackReportType,
): string {
  const entries = loadRecentFeedback(undefined, undefined, reportType);
  if (entries.length === 0) return base;

  const mandatory = buildMandatoryRules(entries);
  const advisory = buildAdvisoryFeedback(entries);

  let result = base;

  // 반복 패턴은 "## 작성 규칙" 섹션 바로 앞에 삽입 (높은 우선순위)
  if (mandatory !== "") {
    const rulesSectionIndex = result.indexOf("\n## 작성 규칙");
    if (rulesSectionIndex !== -1) {
      result =
        result.slice(0, rulesSectionIndex) +
        "\n\n" +
        mandatory +
        result.slice(rulesSectionIndex);
    } else {
      // "## 규칙" 섹션이 없으면 프롬프트 끝에 추가
      result = `${result}\n\n${mandatory}`;
    }
  }

  // 비반복 피드백은 프롬프트 끝에 참고사항으로 추가
  if (advisory !== "") {
    result = `${result}\n\n${advisory}`;
  }

  // 판정 통계 — OK 판정이 저장된 후에만 의미 있음
  const stats = getVerdictStats(entries);
  if (stats.total >= 3) {
    const okPct = Math.round(stats.okRate * 100);
    result = `${result}\n\n## 리뷰 통과 추세\n\n최근 ${stats.total}회 리뷰 중 발송률 ${okPct}% (OK ${stats.ok}, REVISE ${stats.revise}, REJECT ${stats.reject}). 품질 추세를 인지하고 반복 지적 사항을 주의하세요.`;
  }

  return result;
}

/** XML/HTML 특수문자 이스케이프 — 프롬프트 인젝션 방지 */
export function sanitizeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export const ANALYSIS_FRAMEWORK = `## 분석 프레임워크

당신이 사용하는 분석 체계는 Stan Weinstein의 Stage Analysis에 기반합니다:
- **Phase 1 (바닥 구축)**: MA150 횡보, 가격 MA150 부근
- **Phase 2 (상승 추세)**: 가격 > MA150 > MA200, MA 정배열, RS 강세, MA150 기울기 양수
- **Phase 3 (천장 형성)**: 추세 혼조, 분배 시작
- **Phase 4 (하락 추세)**: 가격 < MA150, RS 약세`;
