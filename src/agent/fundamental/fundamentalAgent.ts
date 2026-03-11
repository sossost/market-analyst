/**
 * 펀더멘탈 애널리스트 에이전트.
 *
 * 정량 스코어 + 원시 실적 데이터를 받아
 * LLM이 투자 내러티브를 생성한다.
 */
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "fs";
import { resolve } from "path";
import { callWithRetry } from "../debate/callAgent.js";
import { logger } from "../logger.js";
import type { FundamentalScore, FundamentalInput } from "../../types/fundamental.js";
import type { StockReportContext } from "./stockReport.js";

const PERSONA_PATH = resolve(import.meta.dirname, "../../../.claude/agents/fundamental-analyst.md");
const MODEL = "claude-sonnet-4-20250514";
const MAX_TOKENS = 2048;
const MAX_NARRATIVE_LENGTH = 3000;

interface FundamentalAnalysis {
  symbol: string;
  narrative: string;
  tokensUsed: { input: number; output: number };
}

function loadPersonaPrompt(): string {
  const raw = readFileSync(PERSONA_PATH, "utf-8");
  const match = raw.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
  return match != null ? match[1].trim() : raw;
}

/** @internal — 테스트용 export */
export function buildUserMessage(
  score: FundamentalScore,
  input: FundamentalInput,
  technical?: StockReportContext["technical"],
  isTopGrade?: boolean,
): string {
  const { criteria } = score;
  const lines: string[] = [
    `# ${score.symbol} 펀더멘탈 분석 요청`,
    "",
    `## 등급: ${score.grade} (필수 ${score.requiredMet}/2, 가점 ${score.bonusMet}/2)`,
    "",
  ];

  // 기술적 현황 섹션
  if (technical != null) {
    lines.push(
      "## 기술적 현황",
      `- Phase: ${technical.phase}`,
      `- RS Score: ${technical.rsScore}`,
      `- 52주 고점 대비: ${technical.pctFromHigh52w.toFixed(1)}%`,
      `- 시총: $${technical.marketCapB.toFixed(1)}B`,
      `- 섹터: ${technical.sector} / ${technical.industry}`,
      `- 거래량 확인: ${technical.volumeConfirmed ? "확인" : "미확인"}`,
      "",
    );
  }

  lines.push(
    "## SEPA 기준 판정",
    `- EPS 성장: ${criteria.epsGrowth.detail}`,
    `- 매출 성장: ${criteria.revenueGrowth.detail}`,
    `- EPS 가속: ${criteria.epsAcceleration.detail}`,
    `- 이익률 추세: ${criteria.marginExpansion.detail}`,
    `- ROE: ${criteria.roe.detail}`,
    "",
    "## 분기별 원시 데이터 (최신순)",
  );

  for (const q of input.quarters) {
    const eps = q.epsDiluted != null ? `EPS $${q.epsDiluted}` : "EPS N/A";
    const rev = q.revenue != null ? `매출 $${formatLargeNumber(q.revenue)}` : "매출 N/A";
    const margin = q.netMargin != null ? `마진 ${(q.netMargin * 100).toFixed(1)}%` : "마진 N/A";
    const ni = q.netIncome != null ? `순이익 $${formatLargeNumber(q.netIncome)}` : "순이익 N/A";
    lines.push(`- ${q.asOfQ} (${q.periodEndDate}): ${eps}, ${rev}, ${ni}, ${margin}`);
  }

  lines.push("");

  if (isTopGrade === true) {
    lines.push(
      "이 종목은 S등급(Top 3 슈퍼퍼포머)입니다. 페르소나 문서의 'S등급 종목 심층 분석' 포맷에 따라 6개 섹션으로 심층 분석해주세요.",
    );
  } else {
    lines.push("위 데이터를 바탕으로 이 종목의 펀더멘탈을 2-3문단으로 해석해주세요.");
  }

  // DB 데이터를 XML 래핑하여 프롬프트 인젝션 방어
  const content = lines.join("\n").replace(/<\/?financial-data[^>]*>/g, "");
  return `<financial-data source="db" trust="internal">\n${content}\n</financial-data>`;
}

function formatLargeNumber(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  return n.toLocaleString();
}

export async function analyzeFundamentals(
  client: Anthropic,
  score: FundamentalScore,
  input: FundamentalInput,
  technical?: StockReportContext["technical"],
): Promise<FundamentalAnalysis> {
  const systemPrompt = loadPersonaPrompt();
  const isTopGrade = score.grade === "S";
  const userMessage = buildUserMessage(score, input, technical, isTopGrade);

  logger.info("Fundamental", `Analyzing ${score.symbol} (grade: ${score.grade})`);

  const response = await callWithRetry(() =>
    client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    }),
  );

  const rawNarrative = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((b) => b.text)
    .join("\n");

  const narrative =
    rawNarrative.length > MAX_NARRATIVE_LENGTH
      ? rawNarrative.slice(0, MAX_NARRATIVE_LENGTH) + "…"
      : rawNarrative;

  return {
    symbol: score.symbol,
    narrative,
    tokensUsed: {
      input: response.usage.input_tokens,
      output: response.usage.output_tokens,
    },
  };
}
