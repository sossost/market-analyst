/**
 * 펀더멘탈 장관 에이전트.
 *
 * 정량 스코어 + 원시 실적 데이터를 받아
 * LLM이 투자 내러티브를 생성한다.
 */
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "fs";
import { resolve } from "path";
import { logger } from "../logger.js";
import type { FundamentalScore, FundamentalInput } from "../../types/fundamental.js";

const PERSONA_PATH = resolve(import.meta.dirname, "../../../.claude/agents/fundamental-analyst.md");
const MODEL = "claude-sonnet-4-20250514";
const MAX_TOKENS = 2048;

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

function buildUserMessage(score: FundamentalScore, input: FundamentalInput): string {
  const { criteria } = score;
  const lines: string[] = [
    `# ${score.symbol} 펀더멘탈 분석 요청`,
    "",
    `## 등급: ${score.grade} (필수 ${score.requiredMet}/2, 가점 ${score.bonusMet}/2)`,
    "",
    "## SEPA 기준 판정",
    `- EPS 성장: ${criteria.epsGrowth.detail}`,
    `- 매출 성장: ${criteria.revenueGrowth.detail}`,
    `- EPS 가속: ${criteria.epsAcceleration.detail}`,
    `- 이익률 추세: ${criteria.marginExpansion.detail}`,
    `- ROE: ${criteria.roe.detail}`,
    "",
    "## 분기별 원시 데이터 (최신순)",
  ];

  for (const q of input.quarters) {
    const eps = q.epsDiluted != null ? `EPS $${q.epsDiluted}` : "EPS N/A";
    const rev = q.revenue != null ? `매출 $${formatLargeNumber(q.revenue)}` : "매출 N/A";
    const margin = q.netMargin != null ? `마진 ${q.netMargin}%` : "마진 N/A";
    const ni = q.netIncome != null ? `순이익 $${formatLargeNumber(q.netIncome)}` : "순이익 N/A";
    lines.push(`- ${q.asOfQ} (${q.periodEndDate}): ${eps}, ${rev}, ${ni}, ${margin}`);
  }

  lines.push("");
  lines.push("위 데이터를 바탕으로 이 종목의 펀더멘탈을 2-3문단으로 해석해주세요.");

  return lines.join("\n");
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
): Promise<FundamentalAnalysis> {
  const systemPrompt = loadPersonaPrompt();
  const userMessage = buildUserMessage(score, input);

  logger.info("Fundamental", `Analyzing ${score.symbol} (grade: ${score.grade})`);

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  });

  const narrative = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((b) => b.text)
    .join("\n");

  return {
    symbol: score.symbol,
    narrative,
    tokensUsed: {
      input: response.usage.input_tokens,
      output: response.usage.output_tokens,
    },
  };
}
