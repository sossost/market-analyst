/**
 * GitHub Issues API 클라이언트 — gh CLI 기반
 *
 * gh CLI를 사용하여 GitHub API를 호출한다.
 * 별도 라이브러리 의존 없이, 맥미니에 이미 설치된 gh CLI 활용.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { AutoLabel, GitHubIssue, PriorityLabel } from './types.js'
import { ALLOWED_AUTHORS, AUTO_LABELS, PRIORITY_ORDER } from './types.js'

const execFileAsync = promisify(execFile)

const REPO = 'sossost/market-analyst'

/**
 * gh CLI 실행 헬퍼
 */
async function gh(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('gh', args, {
    timeout: 30_000,
    env: { ...process.env, GH_REPO: REPO },
  })
  return stdout.trim()
}

/**
 * P 라벨에서 우선순위 점수를 반환한다. (낮을수록 높은 우선순위)
 * P0=0, P1=1, P2=2, P3=3, 라벨 없음=4
 */
export function getPriorityScore(labels: string[]): number {
  for (const label of labels) {
    const priority = PRIORITY_ORDER[label as PriorityLabel]
    if (priority != null) return priority
  }
  return PRIORITY_ORDER.__default
}

/**
 * 열린 이슈 중 auto: 라벨이 없는 미처리 이슈 조회 (P 라벨 우선순위순)
 */
export async function fetchUnprocessedIssues(): Promise<GitHubIssue[]> {
  const raw = await gh([
    'issue',
    'list',
    '--state',
    'open',
    '--json',
    'number,title,body,labels,author',
    '--limit',
    '20',
  ])

  if (raw === '') return []

  const issues: Array<{
    number: number
    title: string
    body: string
    labels: Array<{ name: string }>
    author: { login: string }
  }> = JSON.parse(raw)

  return issues
    .filter((issue) => {
      // 허용된 작성자가 아니면 무시 — 프롬프트 인젝션 방지
      const authorLogin = issue.author?.login ?? ''
      if (!ALLOWED_AUTHORS.includes(authorLogin)) return false

      const labelNames = issue.labels.map((l) => l.name)
      // auto: 라벨이 하나라도 있으면 이미 처리된 이슈
      const hasAutoLabel = labelNames.some((name) =>
        AUTO_LABELS.includes(name as AutoLabel),
      )
      return !hasAutoLabel
    })
    .map((issue) => ({
      number: issue.number,
      title: issue.title,
      body: issue.body ?? '',
      labels: issue.labels.map((l) => l.name),
      author: issue.author?.login ?? '',
    }))
    .sort((a, b) => getPriorityScore(a.labels) - getPriorityScore(b.labels))
}

/**
 * 이슈에 라벨 추가
 */
export async function addLabel(
  issueNumber: number,
  label: AutoLabel,
): Promise<void> {
  await gh([
    'issue',
    'edit',
    String(issueNumber),
    '--add-label',
    label,
  ])
}

/**
 * 이슈에서 라벨 제거
 */
export async function removeLabel(
  issueNumber: number,
  label: AutoLabel,
): Promise<void> {
  try {
    await gh([
      'issue',
      'edit',
      String(issueNumber),
      '--remove-label',
      label,
    ])
  } catch {
    // 라벨이 없으면 무시
  }
}

/**
 * 이슈에 코멘트 추가
 */
export async function addComment(
  issueNumber: number,
  body: string,
): Promise<void> {
  await gh([
    'issue',
    'comment',
    String(issueNumber),
    '--body',
    body,
  ])
}
