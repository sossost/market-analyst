/**
 * themeExtractor.ts — LLM 기반 뉴스 테마 추출.
 *
 * 수집된 뉴스 배치를 Claude Sonnet에 전달하여
 * 인과적 섹터 영향 테마(NewsTheme[])를 추출한다.
 *
 * 비용: 1~2회/일, ~$0.03~0.05. 배치 1회 호출 (건별 호출 금지).
 */

import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/db/client";
import { newsThemes, type ThemeSeverity } from "@/db/schema/analyst";
import { getAnthropicClient } from "@/lib/anthropic-client";
import { CLAUDE_SONNET } from "@/lib/models";
import { logger } from "@/lib/logger";

const TAG = "THEME_EXTRACTOR";

const MAX_TOKENS = 4_096;
const TEMPERATURE = 0.2; // 환각 인과관계 최소화

// ─── 타입 ──────────────────────────────────────────────────────────────────────

export interface NewsTheme {
  theme: string; // "PE/CLO 신용경색"
  impactedIndustries: string[]; // FMP 정규화 업종명
  impactMechanism: string; // 인과 메커니즘 설명
  severity: ThemeSeverity;
  sourceCount: number; // 이 테마를 언급한 뉴스 수
}

export interface NewsItem {
  title: string;
  description: string | null;
  category: string;
  source: string | null;
}

// ─── 프롬프트 ──────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a financial market analyst extracting causal risk/opportunity themes from news headlines.

Your task: Given a batch of news headlines, identify 3-10 cross-cutting themes that describe HOW specific events IMPACT specific industries.

RULES:
1. Each theme must describe a causal mechanism (Event → Impact → Industries)
2. impactedIndustries MUST use standard FinViz/FMP industry names. Examples:
   - "Software - Application", "Software - Infrastructure", "Semiconductors", "Semiconductor Equipment & Materials"
   - "Banks - Regional", "Banks - Diversified", "Insurance - Life", "Asset Management"
   - "Oil & Gas E&P", "Oil & Gas Midstream", "Utilities - Regulated Electric"
   - "Biotechnology", "Medical Devices", "Drug Manufacturers - General"
   - "Aerospace & Defense", "Airlines", "Internet Retail", "Specialty Retail"
3. severity: "high" = direct, immediate market impact on impacted industries; "medium" = indirect or developing; "low" = background risk
4. sourceCount = how many of the input headlines relate to this theme
5. Do NOT invent themes with no supporting headlines
6. Do NOT use free-text industry names. Use only standardized names.
7. Respond in Korean for theme names and impactMechanism. Use English for impactedIndustries.

OUTPUT: JSON array only. No markdown fences, no extra text.
[
  {
    "theme": "테마명 (Korean)",
    "impactedIndustries": ["Industry Name 1", "Industry Name 2"],
    "impactMechanism": "인과 메커니즘 설명 (Korean)",
    "severity": "high" | "medium" | "low",
    "sourceCount": 5
  }
]`;

function buildUserMessage(newsItems: NewsItem[]): string {
  const lines = newsItems.map((item, i) => {
    const desc = item.description != null && item.description !== ""
      ? item.description.slice(0, 200)
      : "";
    return `${i + 1}. [${item.category}] ${item.title}${desc.length > 0 ? `\n   ${desc}` : ""} (${item.source ?? "unknown"})`;
  });

  return `## 오늘의 뉴스 (${newsItems.length}건)\n\n${lines.join("\n")}`;
}

// ─── 파싱 ──────────────────────────────────────────────────────────────────────

const VALID_SEVERITIES = new Set<ThemeSeverity>(["low", "medium", "high"]);

export function parseThemeResponse(content: string): NewsTheme[] {
  let jsonStr = content.trim();

  // 코드 펜스 제거
  if (jsonStr.startsWith("```")) {
    jsonStr = jsonStr.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
  }

  // JSON 배열 추출
  const startIdx = jsonStr.indexOf("[");
  const endIdx = jsonStr.lastIndexOf("]");
  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
    logger.warn(TAG, "JSON 배열을 찾을 수 없음");
    return [];
  }

  jsonStr = jsonStr.slice(startIdx, endIdx + 1);

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    logger.warn(TAG, "JSON 파싱 실패");
    return [];
  }

  if (!Array.isArray(parsed)) {
    logger.warn(TAG, "응답이 배열이 아님");
    return [];
  }

  const themes: NewsTheme[] = [];
  for (const item of parsed) {
    if (item == null || typeof item !== "object") continue;

    const raw = item as Record<string, unknown>;
    if (
      typeof raw.theme !== "string" ||
      !Array.isArray(raw.impactedIndustries) ||
      typeof raw.impactMechanism !== "string" ||
      typeof raw.severity !== "string" ||
      typeof raw.sourceCount !== "number"
    ) {
      continue;
    }

    const severity = raw.severity as string;
    if (!VALID_SEVERITIES.has(severity as ThemeSeverity)) {
      continue;
    }

    const industries = (raw.impactedIndustries as unknown[])
      .filter((v): v is string => typeof v === "string" && v.length > 0);

    if (industries.length === 0) continue;

    themes.push({
      theme: raw.theme,
      impactedIndustries: industries,
      impactMechanism: raw.impactMechanism,
      severity: severity as ThemeSeverity,
      sourceCount: Math.max(1, Math.round(raw.sourceCount)),
    });
  }

  return themes;
}

// ─── LLM 호출 ─────────────────────────────────────────────────────────────────

export async function callThemeExtraction(newsItems: NewsItem[]): Promise<NewsTheme[]> {
  const client = getAnthropicClient();
  const userMessage = buildUserMessage(newsItems);

  const response = await client.messages.create({
    model: CLAUDE_SONNET,
    max_tokens: MAX_TOKENS,
    temperature: TEMPERATURE,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
  });

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");

  const inputTokens = response.usage.input_tokens;
  const outputTokens = response.usage.output_tokens;
  logger.info(TAG, `LLM 호출 완료 (${inputTokens}/${outputTokens} tokens)`);

  return parseThemeResponse(text);
}

// ─── DB 저장 ──────────────────────────────────────────────────────────────────

export async function saveThemes(
  date: string,
  themes: NewsTheme[],
): Promise<number> {
  if (themes.length === 0) return 0;

  let inserted = 0;
  for (const theme of themes) {
    try {
      await db.insert(newsThemes).values({
        date,
        theme: theme.theme,
        impactedIndustries: theme.impactedIndustries,
        impactMechanism: theme.impactMechanism,
        severity: theme.severity,
        sourceCount: theme.sourceCount,
      });
      inserted++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(TAG, `테마 저장 실패: ${theme.theme} — ${msg}`);
    }
  }

  return inserted;
}

// ─── 메인 ─────────────────────────────────────────────────────────────────────

const MIN_NEWS_FOR_EXTRACTION = 5;

/**
 * 뉴스 배치에서 인과적 섹터 영향 테마를 추출하고 DB에 저장한다.
 *
 * @param newsItems - 오늘 수집된 뉴스 목록
 * @param date - YYYY-MM-DD 형식 날짜
 * @returns 저장된 테마 수
 */
export async function extractAndSaveThemes(
  newsItems: NewsItem[],
  date: string,
): Promise<{ extracted: number; saved: number }> {
  if (newsItems.length < MIN_NEWS_FOR_EXTRACTION) {
    logger.info(TAG, `뉴스 ${newsItems.length}건 — 최소 ${MIN_NEWS_FOR_EXTRACTION}건 미만, 테마 추출 스킵`);
    return { extracted: 0, saved: 0 };
  }

  logger.info(TAG, `뉴스 ${newsItems.length}건으로 테마 추출 시작`);

  const themes = await callThemeExtraction(newsItems);
  logger.info(TAG, `${themes.length}개 테마 추출됨`);

  const saved = await saveThemes(date, themes);
  logger.info(TAG, `${saved}/${themes.length}개 테마 DB 저장 완료`);

  return { extracted: themes.length, saved };
}
