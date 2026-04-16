/**
 * Phase 2 회귀 여부를 판단한다.
 *
 * Phase 2 진입 종목이 Phase 1(축적 회귀) 또는 Phase 4(하락)로
 * 전환되면 이탈로 판단한다.
 * Phase 3(분배)은 Phase 2의 자연 진행이므로 이탈이 아니다.
 */
export function isPhase2Reverted(currentPhase: number | null): boolean {
  if (currentPhase == null) return false;
  return currentPhase === 1 || currentPhase === 4;
}
