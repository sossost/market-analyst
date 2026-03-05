/**
 * 종목 리포트 생성 + 발송.
 *
 * A급 종목에 대해 구조화된 마크다운 리포트를 생성하고
 * Discord 파일 첨부 + Gist 저장한다.
 */
import { sendDiscordFile, sendDiscordMessage } from "../discord.js";
import { createGist } from "../gist.js";
import { logger } from "../logger.js";
import type { FundamentalScore, FundamentalInput } from "../../types/fundamental.js";

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
}

export function generateStockReport(ctx: StockReportContext): string {
  const { score, input, narrative, technical } = ctx;
  const date = new Date().toISOString().slice(0, 10);

  const lines: string[] = [
    `# [${score.symbol}] 종목 심층 분석`,
    "",
    `> 분석일: ${date} | 펀더멘탈 등급: **${score.grade}**`,
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
    const margin = q.netMargin != null ? `${q.netMargin}%` : "N/A";
    lines.push(`| ${q.asOfQ} | ${eps} | ${rev} | ${ni} | ${margin} |`);
  }

  // 4. LLM 분석
  const narrativeNum = sectionNum + 1;
  lines.push(
    "",
    `## ${narrativeNum}. 펀더멘탈 장관 분석`,
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
  const parts: string[] = [];

  if (technical != null) {
    parts.push(`기술적 Phase ${technical.phase} (RS ${technical.rsScore})`);
  }
  parts.push(`펀더멘탈 ${score.grade}급`);

  if (score.grade === "A") {
    parts.push("— 기술 + 실적 모두 우수한 슈퍼퍼포머 후보");
  } else if (score.grade === "B") {
    parts.push("— 실적 양호, 추가 가속 여부 모니터링 필요");
  }

  return parts.join(" + ");
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
