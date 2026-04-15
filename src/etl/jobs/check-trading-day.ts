import "dotenv/config";
import { db, pool } from "@/db/client";
import { sql } from "drizzle-orm";
import { logger } from "@/lib/logger";
import { sendDiscordMessage } from "@/lib/discord";

const TAG = "CHECK_TRADING_DAY";

const ET_UTC_OFFSET_HOURS = -5;
const SATURDAY = 6;
const SUNDAY = 0;

interface DateRow {
  result_date: string | null;
}

/**
 * UTC 날짜를 받아 기대 거래일(YYYY-MM-DD)을 반환한다.
 * UTC → 미국 동부(ET) 변환 (UTC-5 고정, DST 미적용)
 *
 * ETL은 장 마감 후 실행 (KST 07:00 = ET 전날 17:00)되므로,
 * FMP는 ET 기준 "오늘" 날짜의 데이터를 반환한다.
 * - ET 기준 월~금 → ET 오늘 반환 (장 마감 후이므로 오늘 데이터가 DB에 있어야 함)
 * - ET 기준 토요일 → 금요일 반환
 * - ET 기준 일요일 → 금요일 반환
 *
 * NYSE 공휴일(추수감사절, 크리스마스 등)은 별도 처리하지 않는다.
 * 공휴일이면 FMP가 데이터를 반환하지 않아 DB MAX(date) < 기대일 → exit 2로 자연스럽게 스킵된다.
 */
export function getExpectedTradingDate(nowUtc: Date): string {
  const etOffsetMs = ET_UTC_OFFSET_HOURS * 60 * 60 * 1000;
  const etTime = new Date(nowUtc.getTime() + etOffsetMs);

  const etDayOfWeek = etTime.getUTCDay();
  const etYear = etTime.getUTCFullYear();
  const etMonth = etTime.getUTCMonth();
  const etDate = etTime.getUTCDate();

  if (etDayOfWeek === SATURDAY) {
    // ET 기준 토요일 → 금요일 (어제)
    const friday = new Date(Date.UTC(etYear, etMonth, etDate - 1));
    return toDateString(friday);
  }

  if (etDayOfWeek === SUNDAY) {
    // ET 기준 일요일 → 금요일 (이틀 전)
    const friday = new Date(Date.UTC(etYear, etMonth, etDate - 2));
    return toDateString(friday);
  }

  // ET 기준 월~금 평일 → ET 오늘 반환 (장 마감 후 데이터가 이미 수집됨)
  return toDateString(new Date(Date.UTC(etYear, etMonth, etDate)));
}

function toDateString(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function getLatestDailyPriceDate(): Promise<string | null> {
  const result = await db.execute(sql`
    SELECT MAX(date)::text AS result_date
    FROM daily_prices
  `);
  const row = result.rows[0] as unknown as DateRow | undefined;
  return row?.result_date ?? null;
}

/** exit code: 0 = 거래일, 1 = 예외, 2 = 휴일 스킵 */
export async function main(): Promise<number> {
  try {
    const latestDate = await getLatestDailyPriceDate();

    if (latestDate == null) {
      logger.error(TAG, "daily_prices 테이블에 데이터 없음");
      return 1;
    }

    const expectedDate = getExpectedTradingDate(new Date());
    logger.info(TAG, `DB 최신 날짜: ${latestDate}, 기대 거래일: ${expectedDate}`);

    if (latestDate === expectedDate) {
      logger.info(TAG, "거래일 확인 — 정상 진행");
      return 0;
    }

    logger.info(TAG, `미장 휴일 감지 (latest=${latestDate}, expected=${expectedDate})`);

    await sendDiscordMessage(
      `○ 미장 휴일 감지 — ETL Phase 2 이후 스킵\n기대 거래일: ${expectedDate} / DB 최신: ${latestDate}`,
      "DISCORD_ERROR_WEBHOOK_URL",
    ).catch((err) => {
      const reason = err instanceof Error ? err.message : String(err);
      logger.warn(TAG, `Discord 알림 실패 (무시): ${reason}`);
    });

    return 2;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.error(TAG, `예외 발생: ${reason}`);
    return 1;
  } finally {
    await pool.end().catch((err) => {
      const reason = err instanceof Error ? err.message : String(err);
      logger.warn(TAG, `pool.end() 실패: ${reason}`);
    });
  }
}

// ESM 직접 실행 시에만 호출
const isDirectRun =
  process.argv[1]?.endsWith("check-trading-day.ts") ||
  process.argv[1]?.endsWith("check-trading-day.js");

if (isDirectRun) {
  main().then((code) => process.exit(code));
}
