const BULL_KEYWORDS = ["상승", "돌파", "강세", "긍정", "반등", "회복", "확장", "성장", "호조", "상향"];
const BEAR_KEYWORDS = ["하락", "약세", "부정", "조정", "위축", "둔화", "악화", "하향", "리스크", "경계"];

interface BiasReport {
  bullCount: number;
  bearCount: number;
  totalLearnings: number;
  bullRatio: number;
  isSkewed: boolean;
}

export function detectBullBias(principles: string[]): BiasReport {
  let bullCount = 0;
  let bearCount = 0;

  for (const principle of principles) {
    const hasBull = BULL_KEYWORDS.some((kw) => principle.includes(kw));
    const hasBear = BEAR_KEYWORDS.some((kw) => principle.includes(kw));

    if (hasBull) bullCount++;
    if (hasBear) bearCount++;
  }

  const total = bullCount + bearCount;
  const bullRatio = total > 0 ? bullCount / total : 0.5;
  const isSkewed = bullRatio > 0.8;

  return {
    bullCount,
    bearCount,
    totalLearnings: principles.length,
    bullRatio,
    isSkewed,
  };
}
