import Anthropic from "@anthropic-ai/sdk";

/**
 * Anthropic 클라이언트 싱글턴.
 *
 * 프로세스 내에서 단일 인스턴스를 재사용하여
 * 불필요한 객체 생성과 설정 분산을 방지한다.
 *
 * 모든 에이전트/서비스는 이 함수를 통해 클라이언트를 획득해야 한다.
 */

let instance: Anthropic | null = null;

export function getAnthropicClient(): Anthropic {
  if (instance == null) {
    instance = new Anthropic({ maxRetries: 5 });
  }
  return instance;
}

/** 테스트용 — 싱글턴 인스턴스를 초기화한다. */
export function resetAnthropicClient(): void {
  instance = null;
}
