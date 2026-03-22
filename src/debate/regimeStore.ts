import { db } from "@/db/client";
import {
  marketRegimes,
  type MarketRegimeType,
  type RegimeConfidence,
} from "@/db/schema/analyst";
import { desc, eq, and, gte, lte, sql } from "drizzle-orm";
import { logger } from "@/lib/logger";

const VALID_REGIMES = new Set<string>([
  "EARLY_BULL",
  "MID_BULL",
  "LATE_BULL",
  "EARLY_BEAR",
  "BEAR",
]);

const VALID_CONFIDENCE = new Set<string>(["low", "medium", "high"]);

/**
 * 동일 레짐이 연속으로 판정되어야 확정되는 일수.
 * 너무 작으면 노이즈 제거 효과 없음, 너무 크면 실제 전환도 과도하게 지연됨.
 */
const CONFIRMATION_DAYS = 3;

/**
 * 레짐 전환 확정 후 다른 레짐으로의 전환을 차단하는 최소 유지 기간 (달력일).
 * 7달력일 ≈ 5거래일. 변동성 높은 시장에서 레짐이 매일 바뀌는 것을 방지한다.
 * 동일 레짐 재확정은 쿨다운 미적용.
 */
const MIN_HOLD_CALENDAR_DAYS = 7;

/**
 * 허용된 레짐 전환 맵.
 * 확정된 레짐(confirmed)에서 전환 가능한 레짐 목록을 정의한다.
 * 이 맵에 없는 전환은 CONFIRMATION_DAYS를 채워도 확정되지 않는다.
 *
 * 설계 원칙:
 * - EARLY_BULL ↔ MID_BULL: 강세장 내 인접 단계 전환만 허용
 * - 강세 → 약세 진입점: *_BULL → EARLY_BEAR
 * - 약세 심화: EARLY_BEAR → BEAR
 * - 약세 회복: BEAR → EARLY_BEAR (단계적)
 * - LATE_BULL → EARLY_BULL 건너뜀: 실제로 발생 불가능한 경로 차단
 */
const ALLOWED_TRANSITIONS: Readonly<Record<MarketRegimeType, ReadonlySet<MarketRegimeType>>> = {
  EARLY_BULL: new Set<MarketRegimeType>(["MID_BULL", "EARLY_BEAR"]),
  MID_BULL: new Set<MarketRegimeType>(["LATE_BULL", "EARLY_BULL", "EARLY_BEAR"]),
  LATE_BULL: new Set<MarketRegimeType>(["MID_BULL", "EARLY_BEAR"]),
  EARLY_BEAR: new Set<MarketRegimeType>(["BEAR", "LATE_BULL"]),
  BEAR: new Set<MarketRegimeType>(["EARLY_BEAR"]),
};

/**
 * 인접 거래일로 허용하는 최대 달력일 간격.
 * - 평일 연속(월→화 등): 1일
 * - 주말 포함(금→월): 3일
 * - 공휴일+주말 조합(목→월 등): 4일
 * 4보다 크면 중간에 거래일이 2개 이상 빠진 것이므로 연속으로 보지 않는다.
 */
const MAX_GAP_DAYS = 4;

export interface MarketRegimeInput {
  regime: MarketRegimeType;
  rationale: string;
  confidence: RegimeConfidence;
}

export interface MarketRegimeRow {
  regimeDate: string;
  regime: MarketRegimeType;
  rationale: string;
  confidence: RegimeConfidence;
  isConfirmed: boolean;
  confirmedAt: string | null;
}

/**
 * Validate raw regime object from LLM output.
 * Returns normalized input or null if invalid.
 */
export function validateRegimeInput(raw: unknown): MarketRegimeInput | null {
  if (raw == null || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;

  if (typeof obj.regime !== "string" || !VALID_REGIMES.has(obj.regime)) {
    logger.warn("RegimeStore", `Invalid regime: ${String(obj.regime)}`);
    return null;
  }
  if (typeof obj.rationale !== "string" || obj.rationale.length === 0) {
    logger.warn("RegimeStore", "Missing rationale");
    return null;
  }
  const confidence =
    typeof obj.confidence === "string" && VALID_CONFIDENCE.has(obj.confidence)
      ? obj.confidence
      : "low"; // fallback

  return {
    regime: obj.regime as MarketRegimeType,
    rationale: obj.rationale,
    confidence: confidence as RegimeConfidence,
  };
}

/**
 * LLM 판정 직후 pending 상태로 저장.
 * is_confirmed = false — 히스테리시스 적용 전까지 확정되지 않음.
 * regime_date UNIQUE이므로 같은 날 재실행 시 upsert.
 */
export async function saveRegimePending(
  date: string,
  input: MarketRegimeInput,
): Promise<void> {
  await db
    .insert(marketRegimes)
    .values({
      regimeDate: date,
      regime: input.regime,
      rationale: input.rationale,
      confidence: input.confidence,
      isConfirmed: false,
      confirmedAt: null,
    })
    .onConflictDoUpdate({
      target: marketRegimes.regimeDate,
      set: {
        regime: sql`excluded.regime`,
        rationale: sql`excluded.rationale`,
        confidence: sql`excluded.confidence`,
        isConfirmed: false,
        confirmedAt: null,
      },
      // 이미 확정된 레코드는 덮어쓰지 않는다 — 재실행 시 confirmed 보호
      where: eq(marketRegimes.isConfirmed, false),
    });

  logger.info(
    "RegimeStore",
    `Regime pending: ${date} → ${input.regime} (${input.confidence})`,
  );
}

/**
 * date로부터 CONFIRMATION_DAYS - 1일 이전 날짜를 YYYY-MM-DD 형식으로 반환.
 * pending 조회 윈도우의 시작점으로 사용한다.
 */
function getWindowStart(date: string, windowDays: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - (windowDays - 1));
  return d.toISOString().slice(0, 10);
}

/**
 * 날짜 목록이 거래일 기준으로 인접한지 검증한다.
 * 달력일 차이가 MAX_GAP_DAYS 이하이면 인접 거래일로 간주한다.
 * (금→월 = 3일, 공휴일+주말 조합 최대 4일)
 * dates는 DESC 정렬(최신 → 과거) 상태여야 한다.
 *
 * @internal exported for testing only
 */
/**
 * 두 YYYY-MM-DD 날짜 간 달력일 차이를 반환한다.
 * from이 to보다 과거이면 양수를 반환한다.
 *
 * @internal exported for testing only
 */
export function calendarDaysBetween(from: string, to: string): number {
  const fromDate = new Date(`${from}T00:00:00Z`);
  const toDate = new Date(`${to}T00:00:00Z`);
  return Math.floor(
    (toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24),
  );
}

export function areDatesConsecutive(dates: string[]): boolean {
  for (let i = 0; i < dates.length - 1; i++) {
    const newer = new Date(`${dates[i]}T00:00:00Z`);
    const older = new Date(`${dates[i + 1]}T00:00:00Z`);
    const diffDays =
      (newer.getTime() - older.getTime()) / (1000 * 60 * 60 * 24);
    if (diffDays > MAX_GAP_DAYS) return false;
  }
  return true;
}

/**
 * 히스테리시스 적용: date 기준 최근 CONFIRMATION_DAYS일 윈도우의 pending 레코드를 조회하여
 * 동일 레짐이 달력 기준 연속으로 판정되면 최신 pending을 확정(is_confirmed = true)으로 업데이트.
 *
 * 엣지 케이스:
 * - DB에 confirmed 레코드가 없는 초기 상태에서만 즉시 확정 (pending > 0)
 * - 날짜가 연속이지 않으면 확정하지 않음
 *
 * @returns 현재 확정 레짐 (없으면 null)
 */
export async function applyHysteresis(
  date: string,
): Promise<MarketRegimeRow | null> {
  // 진입 시점에 한 번만 confirmed 레짐 조회
  const confirmedRegime = await loadConfirmedRegime();

  // date 기준 윈도우로 pending 조회 (과거 오래된 pending 오염 방지).
  // 주말/공휴일 간격을 고려해 (CONFIRMATION_DAYS - 1) * MAX_GAP_DAYS일 이전까지 조회한다.
  const windowDays = (CONFIRMATION_DAYS - 1) * MAX_GAP_DAYS + 1;
  const windowStart = getWindowStart(date, windowDays);

  const pendingRows = await db
    .select({
      regimeDate: marketRegimes.regimeDate,
      regime: marketRegimes.regime,
      rationale: marketRegimes.rationale,
      confidence: marketRegimes.confidence,
      isConfirmed: marketRegimes.isConfirmed,
      confirmedAt: marketRegimes.confirmedAt,
    })
    .from(marketRegimes)
    .where(
      and(
        eq(marketRegimes.isConfirmed, false),
        gte(marketRegimes.regimeDate, windowStart),
        lte(marketRegimes.regimeDate, date),
      ),
    )
    .orderBy(desc(marketRegimes.regimeDate))
    .limit(CONFIRMATION_DAYS);

  if (pendingRows.length === 0) {
    return confirmedRegime;
  }

  // 초기 상태(confirmed 없음)에서는 pending이 있으면 즉시 확정
  const isInitialState = confirmedRegime == null;
  const shouldConfirmImmediately = isInitialState && pendingRows.length > 0;

  const allSameRegime = pendingRows.every(
    (r) => r.regime === pendingRows[0].regime,
  );
  const datesConsecutive = areDatesConsecutive(
    pendingRows.map((r) => r.regimeDate),
  );
  const hasEnoughPending = pendingRows.length >= CONFIRMATION_DAYS;

  // 전환 허용 여부 검증 — 초기 상태(confirmed 없음)이면 제약 미적용
  const latestPendingRegime = pendingRows[0].regime;
  const isTransitionAllowed =
    confirmedRegime == null ||
    confirmedRegime.regime === latestPendingRegime ||
    ALLOWED_TRANSITIONS[confirmedRegime.regime].has(latestPendingRegime);

  // 쿨다운 검증 — 레짐 전환 확정 후 MIN_HOLD_CALENDAR_DAYS 이내 재전환 차단
  // 동일 레짐 재확정은 쿨다운 미적용 (레짐 유지 강화)
  const isInCooldown =
    confirmedRegime != null &&
    confirmedRegime.regime !== latestPendingRegime &&
    calendarDaysBetween(
      confirmedRegime.confirmedAt ?? confirmedRegime.regimeDate,
      date,
    ) < MIN_HOLD_CALENDAR_DAYS;

  const canConfirm =
    (shouldConfirmImmediately ||
      (allSameRegime && datesConsecutive && hasEnoughPending)) &&
    isTransitionAllowed &&
    !isInCooldown;

  if (!canConfirm) {
    // 연속 판정 불충족, 허용되지 않은 전환, 또는 쿨다운 — 기존 확정 레짐 유지
    const transitionNote =
      !isTransitionAllowed
        ? ` 허용되지 않은 전환: ${confirmedRegime?.regime} → ${latestPendingRegime}`
        : "";
    const cooldownNote = isInCooldown
      ? ` 쿨다운 중: ${confirmedRegime?.confirmedAt ?? confirmedRegime?.regimeDate}부터 ${MIN_HOLD_CALENDAR_DAYS}일 미경과`
      : "";
    logger.info(
      "RegimeStore",
      `Regime pending — 확정 조건 미충족 (regimes: ${pendingRows.map((r) => r.regime).join(", ")}, consecutive: ${datesConsecutive}, count: ${pendingRows.length}/${CONFIRMATION_DAYS}${transitionNote}${cooldownNote}). 확정 대기 중.`,
    );
    return confirmedRegime;
  }

  // 최신 pending 레코드를 확정 처리
  const latest = pendingRows[0];

  if (confirmedRegime != null && confirmedRegime.regime !== latest.regime) {
    logger.info(
      "RegimeStore",
      `레짐 전환 확정: ${confirmedRegime.regime} → ${latest.regime}`,
    );
  }

  await db
    .update(marketRegimes)
    .set({ isConfirmed: true, confirmedAt: date })
    .where(
      and(
        eq(marketRegimes.regimeDate, latest.regimeDate),
        eq(marketRegimes.isConfirmed, false),
      ),
    );

  logger.info(
    "RegimeStore",
    `Regime confirmed: ${latest.regimeDate} → ${latest.regime} (${latest.confidence})`,
  );

  return {
    regimeDate: latest.regimeDate,
    regime: latest.regime,
    rationale: latest.rationale,
    confidence: latest.confidence,
    isConfirmed: true,
    confirmedAt: date,
  };
}

/**
 * 현재 확정 레짐 조회 (is_confirmed = true 최신 1건).
 */
export async function loadConfirmedRegime(): Promise<MarketRegimeRow | null> {
  const rows = await db
    .select({
      regimeDate: marketRegimes.regimeDate,
      regime: marketRegimes.regime,
      rationale: marketRegimes.rationale,
      confidence: marketRegimes.confidence,
      isConfirmed: marketRegimes.isConfirmed,
      confirmedAt: marketRegimes.confirmedAt,
    })
    .from(marketRegimes)
    .where(eq(marketRegimes.isConfirmed, true))
    .orderBy(desc(marketRegimes.regimeDate))
    .limit(1);

  return (rows[0] as MarketRegimeRow | undefined) ?? null;
}

/**
 * @deprecated loadConfirmedRegime으로 교체. 하위 호환성을 위해 유지.
 * 확정 레짐만 반환한다는 점에서 의미가 동일.
 */
export async function loadLatestRegime(): Promise<MarketRegimeRow | null> {
  return loadConfirmedRegime();
}

/**
 * Load recent N days of confirmed regimes, ordered newest first.
 * is_confirmed = true인 레코드만 반환 — pending 레코드는 제외.
 */
export async function loadRecentRegimes(
  days: number,
): Promise<MarketRegimeRow[]> {
  return db
    .select({
      regimeDate: marketRegimes.regimeDate,
      regime: marketRegimes.regime,
      rationale: marketRegimes.rationale,
      confidence: marketRegimes.confidence,
      isConfirmed: marketRegimes.isConfirmed,
      confirmedAt: marketRegimes.confirmedAt,
    })
    .from(marketRegimes)
    .where(eq(marketRegimes.isConfirmed, true))
    .orderBy(desc(marketRegimes.regimeDate))
    .limit(days) as Promise<MarketRegimeRow[]>;
}

/**
 * 최근 N건의 pending(is_confirmed = false) 레짐을 조회한다.
 * 주간 에이전트가 pending 맥락을 프롬프트에 포함하기 위해 사용.
 */
export async function loadPendingRegimes(
  limit = 5,
): Promise<MarketRegimeRow[]> {
  return db
    .select({
      regimeDate: marketRegimes.regimeDate,
      regime: marketRegimes.regime,
      rationale: marketRegimes.rationale,
      confidence: marketRegimes.confidence,
      isConfirmed: marketRegimes.isConfirmed,
      confirmedAt: marketRegimes.confirmedAt,
    })
    .from(marketRegimes)
    .where(eq(marketRegimes.isConfirmed, false))
    .orderBy(desc(marketRegimes.regimeDate))
    .limit(limit) as Promise<MarketRegimeRow[]>;
}

/**
 * @deprecated saveRegimePending + applyHysteresis로 교체.
 * 하위 호환성을 위해 유지 — 직접 확정 저장 (히스테리시스 없음).
 * 새 코드에서는 사용하지 않는다.
 */
export async function saveRegime(
  date: string,
  input: MarketRegimeInput,
): Promise<void> {
  await db
    .insert(marketRegimes)
    .values({
      regimeDate: date,
      regime: input.regime,
      rationale: input.rationale,
      confidence: input.confidence,
      isConfirmed: true,
      confirmedAt: date,
    })
    .onConflictDoUpdate({
      target: marketRegimes.regimeDate,
      set: {
        regime: sql`excluded.regime`,
        rationale: sql`excluded.rationale`,
        confidence: sql`excluded.confidence`,
        isConfirmed: true,
        confirmedAt: sql`excluded.confirmed_at`,
      },
    });

  logger.info(
    "RegimeStore",
    `Regime saved (legacy): ${date} → ${input.regime} (${input.confidence})`,
  );
}

const REGIME_LABEL: Record<MarketRegimeType, string> = {
  EARLY_BULL: "초기 강세",
  MID_BULL: "중기 강세",
  LATE_BULL: "후기 강세 (과열 경계)",
  EARLY_BEAR: "초기 약세 (방어 전환)",
  BEAR: "약세장 (위양성 주의)",
};

const REGIME_GUIDE: Record<MarketRegimeType, string> = {
  EARLY_BULL: "바닥 돌파 신호 적극 포착. Phase 1→2 전환 종목에 주목.",
  MID_BULL: "정상적 상승 국면. 주도섹터/주도주 포착에 집중.",
  LATE_BULL: "과열 경계. 소수 종목 집중, 브레드스 약화 주의. 신규 추천에 보수적 접근.",
  EARLY_BEAR: "방어 전환 필요. 신규 Phase 2 추천 최소화. 기존 포지션 재평가.",
  BEAR: "약세장. Phase 2 신호 신뢰도 매우 낮음. 현금 비중 확대 고려.",
};

/**
 * 확정 레짐과 pending 상태를 포함한 프롬프트 주입 텍스트 생성.
 *
 * @param confirmedRows 확정(is_confirmed = true) 레짐 목록 (최신순)
 * @param pendingRows   pending(is_confirmed = false) 레짐 목록 (선택적, 디버깅/LLM 맥락용)
 */
export function formatRegimeForPrompt(
  confirmedRows: MarketRegimeRow[],
  pendingRows: MarketRegimeRow[] = [],
): string {
  if (confirmedRows.length === 0 && pendingRows.length === 0) return "";

  const lines: string[] = ["## 시장 레짐 현황", ""];

  if (confirmedRows.length > 0) {
    const latest = confirmedRows[0];
    const label = REGIME_LABEL[latest.regime] ?? latest.regime;
    lines.push(
      `**현재 확정 레짐: ${latest.regime} — ${label}** (${latest.confidence} confidence)`,
      `근거: ${latest.rationale}`,
      `확정일: ${latest.confirmedAt ?? latest.regimeDate}`,
    );
  } else {
    lines.push("**현재 확정 레짐: 없음** (레짐 시스템 초기화 중)");
  }

  // pending 상태 표시 — LLM이 현재 전환 국면임을 인지하도록 참고 정보 제공
  if (pendingRows.length > 0) {
    const pendingDesc = pendingRows
      .map((r) => `${r.regime} (${r.regimeDate})`)
      .join(", ");

    const allSameRegime =
      pendingRows.length > 0 &&
      pendingRows.every((r) => r.regime === pendingRows[0].regime);
    const datesAreConsecutive = areDatesConsecutive(
      pendingRows.map((r) => r.regimeDate),
    );
    const hasEnoughPending = pendingRows.length >= CONFIRMATION_DAYS;

    const confirmNote =
      allSameRegime && datesAreConsecutive && hasEnoughPending
        ? "오늘 확정 예정"
        : allSameRegime && datesAreConsecutive
          ? `${CONFIRMATION_DAYS - pendingRows.length}일 더 연속되면 확정`
          : "판정 불일치 또는 비연속으로 확정 대기";

    lines.push(
      "",
      `**pending 판정 (참고):** ${pendingDesc} — ${confirmNote}`,
      "※ pending은 아직 확정되지 않은 판정입니다. 행동 지침에는 확정 레짐이 적용됩니다.",
    );
  }

  if (confirmedRows.length > 1) {
    lines.push("", "### 최근 확정 레짐 히스토리");
    for (const r of confirmedRows.slice(0, 14)) {
      lines.push(`- ${r.regimeDate}: ${r.regime} (${r.confidence})`);
    }
  }

  // 레짐별 행동 가이드 (확정 레짐 기준)
  if (confirmedRows.length > 0) {
    const latest = confirmedRows[0];
    lines.push("", "### 레짐별 참고 사항");
    const guide = REGIME_GUIDE[latest.regime] ?? `레짐 ${latest.regime}에 대한 가이드 없음`;
    lines.push(`- ${guide}`);
  }

  return lines.join("\n");
}
