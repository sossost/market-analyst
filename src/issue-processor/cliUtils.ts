/**
 * Claude CLI 공유 유틸리티
 *
 * 여러 모듈(executeIssue, triageIssue, feedbackProcessor)이 공통으로 사용하는
 * CLI 실행 관련 헬퍼 함수.
 */

/**
 * Claude Code CLI 실행용 샌드박스 환경 변수를 반환한다.
 * - ANTHROPIC_API_KEY: Max 인증 우선을 위해 제거
 * - Discord 관련 토큰: CLI가 Discord API를 직접 호출하는 사고 방지
 */
export function buildSandboxedEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  delete env.ANTHROPIC_API_KEY
  delete env.DISCORD_BOT_TOKEN
  delete env.DISCORD_PR_CHANNEL_ID
  delete env.DISCORD_WEBHOOK_URL
  delete env.DISCORD_WEEKLY_WEBHOOK_URL
  delete env.DISCORD_ERROR_WEBHOOK_URL
  delete env.DISCORD_DEBATE_WEBHOOK_URL
  delete env.DISCORD_SYSTEM_REPORT_WEBHOOK_URL
  delete env.DISCORD_STOCK_REPORT_WEBHOOK_URL
  return env
}

/**
 * CLI 에러를 분류하여 읽기 쉬운 메시지를 반환한다.
 * @param error - Node.js 에러 객체
 * @param stderr - CLI stderr 출력
 * @param timeoutMs - 타임아웃 설정값 (에러 메시지에 분 단위로 표시)
 */
export function classifyCliError(error: Error, stderr: string, timeoutMs: number): string {
  const nodeError = error as NodeJS.ErrnoException & { killed?: boolean }

  if (nodeError.code === 'ENOENT') {
    return 'Claude CLI를 찾을 수 없음 (PATH에 claude가 없음)'
  }

  if (nodeError.killed === true || nodeError.code === 'ETIMEDOUT') {
    return `Claude CLI 타임아웃 (${timeoutMs / 60_000}분 초과)`
  }

  if (stderr.trim() !== '') {
    return `CLI stderr: ${stderr.trim().slice(0, 500)}`
  }

  return `CLI 실행 실패 (exit non-zero): ${error.message.slice(0, 500)}`
}
