/**
 * 파일시스템에서 최신 펀더멘탈 리포트 조회.
 *
 * data/fundamental-reports/ 디렉토리에서 지정 날짜(또는 당일) 파일 목록을 읽어
 * JSON 형태로 stdout에 출력한다.
 *
 * Usage:
 *   npx tsx src/scripts/get-latest-fundamental-report.ts            # 당일
 *   npx tsx src/scripts/get-latest-fundamental-report.ts 2026-03-11 # 날짜 지정
 *
 * Output:
 *   { "reports": [{ "symbol": "AAPL", "date": "2026-03-11", "content": "..." }] }
 *   또는 리포트 없으면 null
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const REPORTS_DIR = join(process.cwd(), "data", "fundamental-reports");
const FILENAME_PATTERN = /^([A-Z0-9.]+)-(\d{4}-\d{2}-\d{2})\.md$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

interface FundamentalReportEntry {
  symbol: string;
  date: string;
  content: string;
}

interface FundamentalReportResult {
  reports: FundamentalReportEntry[];
}

export async function getLatestFundamentalReports(
  targetDate: string,
): Promise<FundamentalReportResult | null> {
  if (!DATE_PATTERN.test(targetDate)) {
    throw new Error(`유효하지 않은 날짜 포맷: ${targetDate}`);
  }

  let files: string[];
  try {
    files = await readdir(REPORTS_DIR);
  } catch (err) {
    // ENOENT(디렉토리 없음)는 리포트 없음으로 처리, 그 외 에러는 전파
    if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw err;
  }

  const reports: FundamentalReportEntry[] = [];

  for (const file of files) {
    const match = FILENAME_PATTERN.exec(file);
    if (match == null) continue;

    const [, symbol, date] = match;
    if (date !== targetDate) continue;

    const content = await readFile(join(REPORTS_DIR, file), "utf-8");
    reports.push({ symbol, date, content });
  }

  if (reports.length === 0) {
    return null;
  }

  // 심볼 알파벳순 정렬
  reports.sort((a, b) => a.symbol.localeCompare(b.symbol));

  return { reports };
}

// CLI 실행
async function main(): Promise<void> {
  const targetDate = process.argv[2] ?? new Date().toISOString().slice(0, 10);

  const result = await getLatestFundamentalReports(targetDate);
  process.stdout.write(JSON.stringify(result));
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[get-latest-fundamental-report] ${message}`);
  process.exit(1);
});
