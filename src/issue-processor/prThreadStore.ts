/**
 * PR ↔ Discord 스레드 매핑 저장소 — 파일 기반 JSON
 *
 * DB 오버헤드 없이 맥미니 로컬 파일로 충분.
 * PR 수가 많아도 수십 건 이하. 머지/closed 시 삭제하므로 누적 없음.
 *
 * 저장 경로: data/pr-thread-mappings.json
 */

import fs from 'node:fs'
import path from 'node:path'
import { logger } from '@/lib/logger'
import type { PrThreadMapping } from './types.js'

const STORE_PATH = path.resolve(process.cwd(), 'data/pr-thread-mappings.json')
const TAG = 'PR_THREAD_STORE'

/**
 * JSON 파일에서 전체 매핑 목록을 읽는다.
 * 파일 없거나 손상된 경우 빈 배열로 초기화.
 */
export function loadAllMappings(): PrThreadMapping[] {
  if (!fs.existsSync(STORE_PATH)) {
    return []
  }

  try {
    const raw = fs.readFileSync(STORE_PATH, 'utf-8')
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) {
      logger.warn(TAG, 'pr-thread-mappings.json 형식 이상 — 빈 배열로 초기화')
      return []
    }
    return parsed as PrThreadMapping[]
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    logger.warn(TAG, `pr-thread-mappings.json 파싱 실패 — 빈 배열로 초기화: ${reason}`)
    return []
  }
}

/**
 * 전체 매핑 목록을 JSON 파일에 저장한다.
 */
function saveMappings(mappings: PrThreadMapping[]): void {
  const dir = path.dirname(STORE_PATH)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(STORE_PATH, JSON.stringify(mappings, null, 2), 'utf-8')
}

/**
 * PR 번호로 매핑을 조회한다.
 * 없으면 null 반환.
 */
export function findMappingByPrNumber(
  prNumber: number,
): PrThreadMapping | null {
  const mappings = loadAllMappings()
  return mappings.find((m) => m.prNumber === prNumber) ?? null
}

/**
 * 새 매핑을 저장한다.
 * 동일 PR 번호가 이미 있으면 덮어쓴다.
 */
export function savePrThreadMapping(mapping: PrThreadMapping): void {
  const mappings = loadAllMappings()
  const existingIndex = mappings.findIndex(
    (m) => m.prNumber === mapping.prNumber,
  )

  if (existingIndex >= 0) {
    mappings[existingIndex] = mapping
  } else {
    mappings.push(mapping)
  }

  saveMappings(mappings)
  logger.info(
    TAG,
    `매핑 저장: PR #${mapping.prNumber} ↔ thread ${mapping.threadId}`,
  )
}

/**
 * lastScannedMessageId를 갱신한다.
 * 피드백 처리 완료 후 호출하여 다음 루프에서 중복 처리를 방지한다.
 */
export function updateLastScannedMessageId(
  prNumber: number,
  lastScannedMessageId: string,
): void {
  const mappings = loadAllMappings()
  const mapping = mappings.find((m) => m.prNumber === prNumber)

  if (mapping == null) {
    logger.warn(TAG, `PR #${prNumber} 매핑 없음 — lastScannedMessageId 갱신 스킵`)
    return
  }

  const updatedMappings = mappings.map((m) =>
    m.prNumber === prNumber ? { ...m, lastScannedMessageId } : m,
  )

  saveMappings(updatedMappings)
  logger.info(TAG, `lastScannedMessageId 갱신: PR #${prNumber} → ${lastScannedMessageId}`)
}

/**
 * PR 매핑을 삭제한다.
 * PR이 머지/closed 시 호출하여 매핑 파일을 정리한다.
 */
export function removePrThreadMapping(prNumber: number): void {
  const mappings = loadAllMappings()
  const filtered = mappings.filter((m) => m.prNumber !== prNumber)

  if (filtered.length === mappings.length) {
    logger.warn(TAG, `PR #${prNumber} 매핑 없음 — 삭제 스킵`)
    return
  }

  saveMappings(filtered)
  logger.info(TAG, `매핑 삭제: PR #${prNumber}`)
}
