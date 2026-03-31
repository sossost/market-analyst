/**
 * GitHub Issues API 클라이언트 — gh CLI 기반
 *
 * gh CLI를 사용하여 GitHub API를 호출한다.
 * 별도 라이브러리 의존 없이, 맥미니에 이미 설치된 gh CLI 활용.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { AutoLabel, GitHubIssue, PriorityLabel, TriagedLabel } from './types.js'
import { ALLOWED_AUTHORS, AUTO_LABELS, PRIORITY_ORDER, TRIAGED_LABEL } from './types.js'

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
 * 내부 헬퍼 — GitHub에서 열린 이슈를 조회하고 작성자·auto: 라벨 기준으로 필터링한다.
 * triaged 라벨은 여기서 체크하지 않는다 — 호출자가 목적에 맞게 필터링한다.
 */
async function fetchCandidateIssues(): Promise<GitHubIssue[]> {
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
}

/**
 * 이슈 프로세서용 — triaged 라벨이 있고 auto: 라벨이 없는 이슈 조회 (P 라벨 우선순위순)
 *
 * triaged = triageBatch가 PROCEED 판정을 내린 이슈.
 * triaged 없는 이슈는 아직 triage 대기 중이므로 착수 불가.
 */
export async function fetchUnprocessedIssues(): Promise<GitHubIssue[]> {
  const issues = await fetchCandidateIssues()
  return issues
    .filter((issue) => issue.labels.includes(TRIAGED_LABEL))
    .sort((a, b) => getPriorityScore(a.labels) - getPriorityScore(b.labels))
}

/**
 * 트리아지 배치 전용 — triaged 라벨이 없는 미처리 이슈 조회
 *
 * triageBatch 재실행 시 이미 트리아지된 이슈를 중복 처리하지 않도록 방지한다.
 */
export async function fetchUntriagedIssues(): Promise<GitHubIssue[]> {
  const issues = await fetchCandidateIssues()
  return issues.filter((issue) => !issue.labels.includes(TRIAGED_LABEL))
}

/**
 * 이슈에 라벨 추가
 */
export async function addLabel(
  issueNumber: number,
  label: AutoLabel | TriagedLabel,
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

/** 트리아지 코멘트를 식별하는 마커 */
const TRIAGE_MARKER = '[사전 트리아지]'

/**
 * 이슈 코멘트 중 트리아지 마커가 포함된 가장 최근 코멘트의 본문을 반환한다.
 * 마커 이후 내용만 반환하여 헤더 포맷("[사전 트리아지]\n\n")을 제거한다.
 * 트리아지 코멘트가 없으면 undefined를 반환한다.
 */
export async function fetchTriageComment(issueNumber: number): Promise<string | undefined> {
  const raw = await gh([
    'issue',
    'view',
    String(issueNumber),
    '--json',
    'comments',
  ])

  if (raw === '') return undefined

  const data = JSON.parse(raw) as { comments: Array<{ body: string }> }
  const comments = data.comments

  // 가장 최근 것이 뒤에 있으므로 reverse iterate
  for (let i = comments.length - 1; i >= 0; i--) {
    const body = comments[i]?.body ?? ''
    const markerIndex = body.indexOf(TRIAGE_MARKER)
    if (markerIndex !== -1) {
      // 마커 이후 내용 추출 (헤더 라인 제거, 앞뒤 공백 제거)
      return body.slice(markerIndex + TRIAGE_MARKER.length).trim()
    }
  }

  return undefined
}
