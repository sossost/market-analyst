/**
 * 이슈 트리아지 — LLM 기반 자율 처리 가능 여부 판단
 *
 * Claude API로 이슈를 분석하여 자율 처리 가능 여부와 브랜치 타입을 결정한다.
 * 판단이 애매하면 항상 needs-ceo로 보수적 분류.
 */

import Anthropic from '@anthropic-ai/sdk'
import type { GitHubIssue, TriageResult } from './types.js'

function requireEnv(key: string): string {
  const value = process.env[key]
  if (value == null || value === '') {
    throw new Error(`Missing required environment variable: ${key}`)
  }
  return value
}

// 모듈 로드 시점에 API 키 검증 — 이슈 처리 루프 진입 전 빠르게 실패
requireEnv('ANTHROPIC_API_KEY')

// 싱글톤 클라이언트 — 커넥션 재사용
const client = new Anthropic()

const TRIAGE_SYSTEM_PROMPT = `당신은 소프트웨어 프로젝트의 이슈 트리아지 전문가입니다.

## 프로젝트 컨텍스트
- Market Analyst: Claude Agent 기반 시장 분석 시스템
- 스택: Node.js, TypeScript, Drizzle ORM, PostgreSQL, Claude API
- 프로젝트 골: Phase 2(상승 초입) 주도섹터/주도주를 남들보다 먼저 포착하여 알파 형성

## 판단 기준

### 자율 처리 가능 (decision: "auto")
다음을 **모두** 만족해야 함:
1. 버그 픽스, 명확한 개선, 리팩토링 중 하나
2. 코드베이스에 선례가 있을 것으로 추정되는 수정
3. 다른 이슈에 블로킹되지 않음
4. 프로젝트 골과 부합

### CEO 판단 필요 (decision: "needs-ceo")
다음 중 **하나라도** 해당:
1. 새 기능 (기존에 없는 기능 추가)
2. 아키텍처 변경 (모듈 구조, DB 스키마, API 계약 변경)
3. 트레이드오프가 있는 의사결정
4. 외부 시스템 연동 추가
5. 이슈 본문만으로 구현 범위가 불분명
6. 비용이 유의미하게 증가할 것으로 예상

**원칙: 판단이 애매하면 반드시 "needs-ceo".**

## 출력 형식
JSON으로만 응답하세요:
{
  "decision": "auto" | "needs-ceo",
  "reason": "판단 사유 (한국어, 1~2문장)",
  "branchType": "fix" | "feat" | "refactor" | "chore"
}`

function buildTriagePrompt(issue: GitHubIssue): string {
  return `다음 GitHub 이슈를 분석하여 자율 처리 가능 여부를 판단하세요.

<issue>
제목: ${issue.title}
라벨: ${issue.labels.join(', ') || '없음'}
본문:
${issue.body || '(본문 없음)'}
</issue>`
}

export async function triageIssue(
  issue: GitHubIssue,
): Promise<TriageResult> {
  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 500,
    system: TRIAGE_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: buildTriagePrompt(issue),
      },
    ],
  })

  const text =
    response.content[0].type === 'text' ? response.content[0].text : ''

  try {
    // JSON 코드펜스 제거 후 파싱
    const cleaned = text
      .replace(/^```json\s*/m, '')
      .replace(/^```\s*/m, '')
      .replace(/```$/m, '')
      .trim()
    const parsed = JSON.parse(cleaned) as {
      decision: string
      reason: string
      branchType: string
    }

    const decision =
      parsed.decision === 'auto' ? 'auto' : ('needs-ceo' as const)
    const branchType = ['fix', 'feat', 'refactor', 'chore'].includes(
      parsed.branchType,
    )
      ? (parsed.branchType as 'fix' | 'feat' | 'refactor' | 'chore')
      : 'fix'

    return {
      issueNumber: issue.number,
      decision,
      reason: parsed.reason ?? '판단 사유 없음',
      branchType,
    }
  } catch {
    // LLM 응답 파싱 실패 → 보수적으로 needs-ceo
    return {
      issueNumber: issue.number,
      decision: 'needs-ceo',
      reason: 'LLM 응답 파싱 실패 — 보수적으로 에스컬레이션',
      branchType: 'fix',
    }
  }
}
