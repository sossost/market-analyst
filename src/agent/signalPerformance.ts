import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const BACKTEST_DIR = join(process.cwd(), "data", "backtest");
const BACKTEST_FILE_PREFIX = "signal-backtest-";
const BACKTEST_FILE_SUFFIX = ".json";

interface BacktestReturns {
  avg: number;
  median: number;
  winRate: number;
  count: number;
}

interface PhaseExit {
  avgReturn: number;
  medianReturn: number;
  winRate: number;
  avgDays: number;
  count: number;
}

interface ParamResult {
  rsThreshold: number;
  volumeRequired: boolean;
  sectorFilter: boolean;
  totalSignals: number;
  returns: Record<string, BacktestReturns>;
  phaseExit: PhaseExit;
  avgMaxReturn: number;
}

interface BacktestData {
  runDate: string;
  dataRange: { from: string; to: string };
  totalSignals: number;
  paramResults: ParamResult[];
}

function findBestConfig(paramResults: ParamResult[]): ParamResult | null {
  if (paramResults.length === 0) return null;

  // Best = highest 20d avg return with at least 50 signals
  const candidates = paramResults.filter((r) => r.totalSignals >= 50);
  if (candidates.length === 0) return paramResults[0];

  return candidates.reduce((best, current) => {
    const bestReturn = best.returns["20"]?.avg ?? 0;
    const currentReturn = current.returns["20"]?.avg ?? 0;
    return currentReturn > bestReturn ? current : best;
  });
}

function formatPercent(value: number): string {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

function formatConfigLabel(config: ParamResult): string {
  const parts: string[] = [`RS>=${config.rsThreshold}`];
  if (config.volumeRequired) parts.push("거래량확인");
  if (config.sectorFilter) parts.push("섹터필터");
  return parts.join(" + ");
}

function buildSummaryText(data: BacktestData): string {
  const best = findBestConfig(data.paramResults);
  if (best == null) return "";

  const dayCount = Math.ceil(
    (new Date(data.dataRange.to).getTime() -
      new Date(data.dataRange.from).getTime()) /
      (1000 * 60 * 60 * 24),
  );

  const ret20d = best.returns["20"];
  const configLabel = formatConfigLabel(best);

  const lines: string[] = [
    `기계적 시그널 백테스트 (${dayCount}일, 최신 ${data.dataRange.to}): ${configLabel} 조합이 최적.`,
  ];

  if (ret20d != null && ret20d.count > 0) {
    lines.push(
      `20일 평균 수익률 ${formatPercent(ret20d.avg)} (N=${ret20d.count}, 승률 ${ret20d.winRate.toFixed(1)}%).`,
    );
  }

  if (best.phaseExit.count > 0) {
    lines.push(
      `Phase 종료 시점 승률은 ${best.phaseExit.winRate.toFixed(1)}%로 낮아 Phase 2 유지 여부가 핵심.`,
    );
  }

  return lines.join(" ");
}

/**
 * 가장 최근 signal-backtest-*.json 파일을 찾아서 로드합니다.
 * 파일이 없거나 파싱 실패 시 null을 반환합니다.
 */
export function loadLatestBacktestData(): BacktestData | null {
  let files: string[];
  try {
    files = readdirSync(BACKTEST_DIR);
  } catch {
    return null;
  }

  const backtestFiles = files
    .filter(
      (f) => f.startsWith(BACKTEST_FILE_PREFIX) && f.endsWith(BACKTEST_FILE_SUFFIX),
    )
    .sort()
    .reverse();

  if (backtestFiles.length === 0) return null;

  try {
    const content = readFileSync(join(BACKTEST_DIR, backtestFiles[0]), "utf-8");
    return JSON.parse(content) as BacktestData;
  } catch {
    return null;
  }
}

/**
 * 시그널 성과를 시스템 프롬프트에 주입할 텍스트로 변환합니다.
 * 파일이 없거나 데이터가 유효하지 않으면 빈 문자열을 반환합니다.
 */
export function loadSignalPerformanceSummary(): string {
  const data = loadLatestBacktestData();
  if (data == null) return "";

  return buildSummaryText(data);
}
