/**
 * Strategic Review — 핵심 타입
 *
 * 전략 참모 자동 리뷰 인프라에서 사용되는 타입 정의.
 * 6개 리뷰어가 생성한 인사이트를 품질 필터 → 중복 체크 → 이슈 생성 파이프라인으로 처리한다.
 */

/**
 * 리뷰어 포커스 영역 — 이슈 제목 포맷의 {포커스}에 매핑
 */
export type ReviewFocus =
  | "capture-logic"
  | "learning-loop"
  | "prompt-insight"
  | "debate-structure"
  | "data-source"
  | "market-structure";

/**
 * 이슈 우선순위
 * - P1: 골 달성에 직접적 블로커
 * - P2: 포착력 향상 기회
 * - P3: 장기 개선 항목
 */
export type Priority = "P1" | "P2" | "P3";

/**
 * 리뷰어가 생성하는 인사이트 단위
 */
export interface Insight {
  /** 인사이트 제목 — 이슈 제목에 사용 */
  title: string;
  /** 인사이트 본문 — 근거, 개선안, 코드 참조 포함 */
  body: string;
  /** 포커스 영역 */
  focus: ReviewFocus;
  /** 우선순위 */
  priority: Priority;
  /** 생성한 리뷰어 이름 (디버깅/로깅용) */
  reviewerName: string;
}

/**
 * qualityFilter가 각 인사이트에 대해 평가하는 점수
 */
export interface QualityScore {
  /** 파일명/함수명/조건값 포함 여부 (1-5) */
  specificity: number;
  /** Phase 2 초입 포착에 직접 영향 여부 (1-5) */
  goalAlignment: number;
  /** 다음 스프린트에 처리 가능 여부 (1-5) */
  actionability: number;
  /** 코드/데이터 증거 포함 여부 (1-5) */
  evidenceSufficiency: number;
  /** 총점 (4개 합산, 12점 이상만 통과) */
  total: number;
}

/**
 * 품질 필터 결과
 */
export interface QualityFilterResult {
  insight: Insight;
  score: QualityScore;
  passed: boolean;
}

/**
 * GitHub 이슈 생성 결과
 */
export interface IssueCreationResult {
  issueNumber: number;
  url: string;
  title: string;
}

/**
 * 오케스트레이터 최종 실행 결과 요약
 */
export interface StrategicReviewResult {
  totalInsights: number;
  passedQualityFilter: number;
  deduplicated: number;
  issuesCreated: number;
  createdIssues: IssueCreationResult[];
  skippedDuplicates: string[];
}
