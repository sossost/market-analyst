/**
 * Strategic Review — 오케스트레이터
 *
 * 전략 참모 자동 리뷰 인프라. KST 06:00 매일 실행.
 *
 * 흐름:
 * 1. 리뷰어들 병렬 실행 (Phase 1: captureLogicAuditor + learningLoopAuditor)
 * 2. 인사이트 품질 필터 (qualityFilter — 12점 미달 폐기)
 * 3. 중복 체크 (deduplicator — 기존 오픈 이슈와 Jaccard 유사도)
 * 4. GitHub 이슈 생성 (issueCreator — P1/P2/P3 + strategic-review 라벨)
 */

import "dotenv/config";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "../agent/logger.js";
import { runCaptureLogicAudit } from "./reviewers/captureLogicAuditor.js";
import { runLearningLoopAudit } from "./reviewers/learningLoopAuditor.js";
import { filterInsightsByQuality } from "./qualityFilter.js";
import { deduplicateInsights } from "./deduplicator.js";
import { createIssues } from "./issueCreator.js";
import type { Insight, StrategicReviewResult } from "./types.js";
import { pool } from "../db/client.js";

const TAG = "STRATEGIC_REVIEW";
const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "../..");

/**
 * 모든 리뷰어를 병렬 실행하고 인사이트를 수집한다.
 *
 * Phase 1: captureLogicAuditor + learningLoopAuditor
 * Phase 2 이후 리뷰어가 추가될 때 이 배열에만 추가하면 자동 포함됨.
 */
async function runAllReviewers(): Promise<Insight[]> {
  const reviewerJobs = [
    {
      name: "captureLogicAuditor",
      run: () => runCaptureLogicAudit(PROJECT_ROOT),
    },
    {
      name: "learningLoopAuditor",
      run: () => runLearningLoopAudit(),
    },
    // Phase 2 리뷰어 — 이 주석 아래에 추가
    // { name: "promptInsightReviewer", run: () => runPromptInsightReview(PROJECT_ROOT) },
    // { name: "debateStructureReviewer", run: () => runDebateStructureReview(PROJECT_ROOT) },
    // { name: "dataSourceGapFinder", run: () => runDataSourceGapFind(PROJECT_ROOT) },
    // { name: "marketStructureReviewer", run: () => runMarketStructureReview() },
  ];

  const results = await Promise.allSettled(
    reviewerJobs.map((job) => job.run()),
  );

  const allInsights: Insight[] = [];

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const jobName = reviewerJobs[i].name;

    if (result.status === "fulfilled") {
      logger.info(TAG, `${jobName} 완료 — ${result.value.length}개 인사이트`);
      allInsights.push(...result.value);
    } else {
      logger.warn(
        TAG,
        `${jobName} 실패 — 스킵: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
      );
    }
  }

  return allInsights;
}

/**
 * Strategic Review 메인 파이프라인
 */
async function runStrategicReview(): Promise<StrategicReviewResult> {
  logger.info(TAG, "=== Strategic Review 시작 ===");

  // 1. 리뷰어 병렬 실행
  logger.info(TAG, "1/4. 리뷰어 병렬 실행 중...");
  const allInsights = await runAllReviewers();
  logger.info(TAG, `총 ${allInsights.length}개 인사이트 수집`);

  if (allInsights.length === 0) {
    logger.info(TAG, "인사이트 없음. 종료.");
    return {
      totalInsights: 0,
      passedQualityFilter: 0,
      deduplicated: 0,
      issuesCreated: 0,
      createdIssues: [],
      skippedDuplicates: [],
    };
  }

  // 2. 품질 필터
  logger.info(TAG, "2/4. 품질 필터 적용 중...");
  const { passed, results: filterResults } = await filterInsightsByQuality(allInsights);

  const failedCount = filterResults.filter((r) => !r.passed).length;
  logger.info(
    TAG,
    `품질 필터: ${passed.length}개 통과, ${failedCount}개 폐기`,
  );

  for (const r of filterResults) {
    const status = r.passed ? "통과" : "폐기";
    logger.info(
      TAG,
      `  [${status}] "${r.insight.title}" — 총점 ${r.score.total}/20 (구체성:${r.score.specificity} 골:${r.score.goalAlignment} 실행:${r.score.actionability} 근거:${r.score.evidenceSufficiency})`,
    );
  }

  if (passed.length === 0) {
    logger.info(TAG, "품질 필터 통과 인사이트 없음. 종료.");
    return {
      totalInsights: allInsights.length,
      passedQualityFilter: 0,
      deduplicated: 0,
      issuesCreated: 0,
      createdIssues: [],
      skippedDuplicates: [],
    };
  }

  // 3. 중복 체크
  logger.info(TAG, "3/4. 중복 체크 중...");
  const { unique, skipped: skippedDuplicates } = await deduplicateInsights(passed);
  logger.info(
    TAG,
    `중복 체크: ${unique.length}개 고유, ${skippedDuplicates.length}개 중복 스킵`,
  );

  for (const dup of skippedDuplicates) {
    logger.info(TAG, `  [스킵] ${dup}`);
  }

  if (unique.length === 0) {
    logger.info(TAG, "신규 인사이트 없음. 종료.");
    return {
      totalInsights: allInsights.length,
      passedQualityFilter: passed.length,
      deduplicated: skippedDuplicates.length,
      issuesCreated: 0,
      createdIssues: [],
      skippedDuplicates,
    };
  }

  // 4. GitHub 이슈 생성
  logger.info(TAG, "4/4. GitHub 이슈 생성 중...");
  const createdIssues = await createIssues(unique);
  logger.info(TAG, `${createdIssues.length}개 이슈 생성 완료`);

  for (const issue of createdIssues) {
    logger.info(TAG, `  [생성] #${issue.issueNumber}: ${issue.title}`);
    logger.info(TAG, `         ${issue.url}`);
  }

  logger.info(TAG, "=== Strategic Review 완료 ===");

  return {
    totalInsights: allInsights.length,
    passedQualityFilter: passed.length,
    deduplicated: skippedDuplicates.length,
    issuesCreated: createdIssues.length,
    createdIssues,
    skippedDuplicates,
  };
}

async function main() {
  try {
    const result = await runStrategicReview();

    logger.info(TAG, "=== 실행 요약 ===");
    logger.info(TAG, `  총 인사이트: ${result.totalInsights}`);
    logger.info(TAG, `  품질 필터 통과: ${result.passedQualityFilter}`);
    logger.info(TAG, `  중복 스킵: ${result.deduplicated}`);
    logger.info(TAG, `  이슈 생성: ${result.issuesCreated}`);

    process.exit(0);
  } catch (error) {
    logger.error(
      TAG,
      `치명적 오류: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
