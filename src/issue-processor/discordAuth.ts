/**
 * Discord 발신자 인증 — 공유 유틸리티
 *
 * feedbackProcessor, loopOrchestrator 양쪽에서 사용하는
 * 허용 사용자 확인 로직을 단일 모듈로 관리한다.
 */

/**
 * 허용된 Discord 사용자 ID 목록을 환경변수에서 읽는다.
 * ALLOWED_DISCORD_USER_IDS: 쉼표로 구분된 ID 목록
 */
export function getAllowedUserIds(): string[] {
  const raw = process.env.ALLOWED_DISCORD_USER_IDS
  if (raw == null || raw === '') return []
  return raw.split(',').map((id) => id.trim()).filter((id) => id !== '')
}

/**
 * 발신자가 허용된 사용자인지 확인한다.
 * 환경변수 미설정 시 보안을 위해 모두 차단한다.
 */
export function isAllowedSender(authorId: string): boolean {
  const allowed = getAllowedUserIds()
  if (allowed.length === 0) return false
  return allowed.includes(authorId)
}
