/**
 * 종목 리포트 생성 + 발송.
 *
 * A급 종목에 대해 구조화된 마크다운 리포트를 생성하고
 * Discord 파일 첨부 + Gist 저장한다.
 */
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

import { sendDiscordFile } from "@/lib/discord";
import { createGist } from "@/lib/gist";
import { logger } from "@/lib/logger";
import type { DataQualityVerdict, FundamentalScore, FundamentalInput } from "@/types/fundamental";

const DISCORD_WEBHOOK_ENV = "DISCORD_STOCK_REPORT_WEBHOOK_URL";

export interface StockReportContext {
  score: FundamentalScore;
  input: FundamentalInput;
  narrative: string;
  /** 기술적 현황 (Phase, RS, 거래량 등) — 있으면 포함 */
  technical?: {
    phase: number;
    rsScore: number;
    volumeConfirmed: boolean;
    pctFromHigh52w: number;
    marketCapB: number;
    sector: string;
    industry: string;
  };
  /** S급 LLM 데이터 품질 검증 결과 */
  dataQualityVerdict?: DataQualityVerdict;
  /** A→S 보충 승격 여부 */
  isPromoted?: boolean;
}

export function generateStockReport(ctx: StockReportContext): string {
  const { score, input, narrative, technical } = ctx;
  const date = new Date().toISOString().slice(0, 10);

  const lines: string[] = [
    `# [${score.symbol}] 종목 심층 분석`,
    "",
    ctx.dataQualityVerdict === "CLEAN"
      ? `> 분석일: ${date} | 펀더멘탈 등급: **${ctx.isPromoted === true ? "S (보충 승격)" : score.grade}** | 데이터 품질: ✅ 검증 통과`
      : `> 분석일: ${date} | 펀더멘탈 등급: **${score.grade}**`,
    "",
  ];

  // 1. 기술적 현황
  if (technical != null) {
    lines.push(
      "## 1. 기술적 현황",
      "",
      `- Phase ${technical.phase}, RS ${technical.rsScore}`,
      `- 52주 고점 대비 ${technical.pctFromHigh52w.toFixed(1)}%`,
      `- 시총 $${technical.marketCapB.toFixed(1)}B`,
      `- 섹터: ${technical.sector} / ${technical.industry}`,
      `- 거래량 확인: ${technical.volumeConfirmed ? "확인" : "미확인"}`,
      "",
    );
  }

  // 2. 펀더멘탈 등급
  const { criteria } = score;
  lines.push(
    technical != null ? "## 2. 펀더멘탈 분석" : "## 1. 펀더멘탈 분석",
    "",
    `**등급: ${score.grade}** (필수 ${score.requiredMet}/2, 가점 ${score.bonusMet}/2)`,
    "",
    "| 기준 | 판정 | 상세 |",
    "|------|------|------|",
    `| EPS 성장 (필수) | ${criteria.epsGrowth.passed ? "✅" : "❌"} | ${criteria.epsGrowth.detail} |`,
    `| 매출 성장 (필수) | ${criteria.revenueGrowth.passed ? "✅" : "❌"} | ${criteria.revenueGrowth.detail} |`,
    `| EPS 가속 (가점) | ${criteria.epsAcceleration.passed ? "✅" : "❌"} | ${criteria.epsAcceleration.detail} |`,
    `| 이익률 확대 (가점) | ${criteria.marginExpansion.passed ? "✅" : "❌"} | ${criteria.marginExpansion.detail} |`,
    "",
  );

  // 3. 분기별 실적
  const sectionNum = technical != null ? 3 : 2;
  lines.push(
    `## ${sectionNum}. 분기별 실적`,
    "",
    "| 분기 | EPS | 매출 | 순이익 | 이익률 |",
    "|------|-----|------|--------|--------|",
  );

  for (const q of input.quarters.slice(0, 8)) {
    const eps = q.epsDiluted != null ? `$${q.epsDiluted}` : "N/A";
    const rev = q.revenue != null ? `$${formatB(q.revenue)}` : "N/A";
    const ni = q.netIncome != null ? `$${formatB(q.netIncome)}` : "N/A";
    const margin = q.netMargin != null ? `${q.netMargin.toFixed(1)}%` : "N/A";
    lines.push(`| ${q.asOfQ} | ${eps} | ${rev} | ${ni} | ${margin} |`);
  }

  // 4. LLM 분석
  const narrativeNum = sectionNum + 1;
  lines.push(
    "",
    `## ${narrativeNum}. 펀더멘탈 애널리스트 분석`,
    "",
    narrative,
    "",
  );

  // 5. 종합 판단
  const summaryNum = narrativeNum + 1;
  lines.push(
    `## ${summaryNum}. 종합 판단`,
    "",
    buildSummary(score, technical),
  );

  return lines.join("\n");
}

function buildSummary(
  score: FundamentalScore,
  technical?: StockReportContext["technical"],
): string {
  const lines: string[] = [];

  // 기술적 + 펀더멘탈 조합 헤더
  const techLabel = technical != null
    ? `Phase ${technical.phase} (RS ${technical.rsScore})`
    : null;
  const gradeLabel = `펀더멘탈 ${score.grade}등급`;

  if (techLabel != null) {
    lines.push(`**${techLabel} + ${gradeLabel}**`);
  } else {
    lines.push(`**${gradeLabel}**`);
  }

  lines.push("");

  // 등급별 판단
  if (score.grade === "S") {
    lines.push(buildSGradeSummary(technical));
  } else if (score.grade === "A") {
    lines.push("기술 + 실적 모두 우수한 슈퍼퍼포머 후보. 진입 타이밍 탐색 구간.");
  } else if (score.grade === "B") {
    lines.push("실적 양호하나 가속이 부족. 추가 가속 여부 모니터링 필요.");
  } else {
    lines.push("실적 미달 — 기술적 위치와 무관하게 펀더멘탈 개선 확인 전까지 관망.");
  }

  return lines.join("\n");
}

function buildSGradeSummary(
  technical?: StockReportContext["technical"],
): string {
  const parts: string[] = [];

  parts.push("**최우선 관찰 대상** — 실적 최상위 슈퍼퍼포머 (Top 3)");
  parts.push("");

  if (technical != null) {
    const { phase, rsScore, pctFromHigh52w } = technical;

    // Phase + RS 조합 해석
    if (phase === 2 && rsScore >= 80) {
      parts.push("- 기술적 Phase 2 + RS 상위권: 상승 초입 구간, 가장 이상적인 포지션");
    } else if (phase === 2) {
      parts.push("- 기술적 Phase 2: 상승 초입이나 RS 보강 필요");
    } else if (phase === 1) {
      parts.push(`- 기술적 Phase 1 (RS ${rsScore}): 베이스 형성 중, Phase 2 전환 모니터링`);
    } else {
      parts.push(`- 기술적 Phase ${phase} (RS ${rsScore}): 기술적 위치 비이상적, 실적 강도만으로 관찰`);
    }

    // 52주 고점 대비 해석
    if (pctFromHigh52w >= -5) {
      parts.push("- 52주 고점 근접: 신고가 돌파 임박 — 돌파 시 모멘텀 가속 가능");
    } else if (pctFromHigh52w >= -15) {
      parts.push(`- 52주 고점 대비 ${pctFromHigh52w.toFixed(1)}%: 건전한 조정 범위, 회복 추세 확인 필요`);
    } else {
      parts.push(`- 52주 고점 대비 ${pctFromHigh52w.toFixed(1)}%: 큰 폭 조정, 기술적 회복 확인 후 재평가`);
    }
  } else {
    parts.push("기술적 데이터 미확보 — 펀더멘탈 기준 최상위 종목으로 기술적 확인 필요");
  }

  return parts.join("\n");
}

function formatB(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(0)}M`;
  return n.toLocaleString();
}

// ─── 발송 ───────────────────────────────────────────────────────────

export async function publishStockReport(
  symbol: string,
  reportMd: string,
): Promise<{ gistUrl: string | null }> {
  const date = new Date().toISOString().slice(0, 10);
  const filename = `${symbol}-${date}.md`;

  // 파일 저장 (검증용)
  try {
    const reportsDir = join(process.cwd(), "data", "fundamental-reports");
    await mkdir(reportsDir, { recursive: true });
    await writeFile(join(reportsDir, filename), reportMd, "utf-8");
    logger.info("StockReport", `${symbol} 파일 저장: data/fundamental-reports/${filename}`);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.warn("StockReport", `${symbol} 파일 저장 실패 (계속 진행): ${reason}`);
  }

  // Gist 저장
  const gist = await createGist(
    filename,
    reportMd,
    `[${symbol}] 종목 심층 분석 — ${date}`,
  );
  const gistUrl = gist?.url ?? null;

  // Discord 발송
  const webhookUrl = process.env[DISCORD_WEBHOOK_ENV];
  if (webhookUrl != null && webhookUrl !== "") {
    const summary = `📊 **[${symbol}] 종목 리포트 발행**${gistUrl != null ? `\n🔗 ${gistUrl}` : ""}`;
    try {
      await sendDiscordFile(webhookUrl, summary, filename, reportMd);
      logger.info("StockReport", `${symbol} Discord 발송 완료`);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      logger.error("StockReport", `${symbol} Discord 발송 실패: ${reason}`);
    }
  } else {
    logger.warn("StockReport", `${DISCORD_WEBHOOK_ENV} 미설정 — Discord 발송 생략`);
  }

  return { gistUrl };
}
