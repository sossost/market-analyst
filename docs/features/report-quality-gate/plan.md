# report-quality-gate (재설계)

이슈 #224 + #229 통합 기획서 — v2 (기존 기획 폐기 후 재작성)

## 선행 맥락

- **#197 / daily-report-quality-197**: `systemPrompt.ts` Bull-Bias 가드레일에 "Phase 분류 ↔ 서술 일관성 검증 절차"를 이미 추가했다 (PR 완료). 텍스트 지시로 내면화를 유도했으나, #224가 그 규칙을 통과하고도 Phase 2 분류 + 당일 급락 서술 모순이 발생했다. 텍스트 지시만으로는 불충분하다는 것이 증명됐다.
- **#191 / fundamental-report-quality**: S등급 6섹션 포맷, MAX_TOKENS 4096 완료.
- **기각된 접근**: CEO가 "LLM이 만든 걸 LLM이 리뷰 → 수정하는 루프"를 차단했다. 같은 체계 내 순환이며, #224가 기존 `runReviewPipeline`을 통과하고도 발생한 것이 그 증거다.
- **리뷰 결과 전달 채널 변경**: Discord 발송 아님 → **GitHub 이슈 생성**으로 통일.

## 골 정렬

**ALIGNED** — 직접 기여.

- #224: Phase 2 분류인데 당일 -5% 이상 급락한 종목이 추천 섹션에 포함되는 것은 독자의 투자 판단을 직접 왜곡한다. 리포트 신뢰도 0.
- #229: S등급 종목 리포트에 QA가 없으면 데이터 오류가 그대로 발행된다. S등급은 투자 판단의 최우선 인풋이므로 품질 검출 루프가 필수다.

## 문제

**#224 근본 원인**: `get_unusual_stocks` 도구가 반환하는 종목에는 Phase 2 + 당일 -5% 이상 급락한 종목이 혼재한다. 이 도구 결과를 에이전트가 그대로 리포트에 포함할 때 "Phase 2 추천인데 급락 서술" 모순이 발생한다. 기존 systemPrompt 텍스트 지시(Bull-Bias 가드레일)는 이 케이스를 명시적으로 차단하지 않는다. 또한 `get_phase2_stocks` 결과에도 당일 가격 데이터가 포함되지 않아, Phase 2 종목이 당일 급락한 경우를 사전 필터링할 수단이 없다.

**#229 근본 원인**: `publishStockReport`는 마크다운을 생성 즉시 발행한다. 생성된 리포트에 데이터 불일치(마진 소수점 미변환, EPS 수치 불일치 등)가 있어도 검출 수단이 없다. 발행 후에 CEO가 직접 발견하는 구조다.

## Before → After

### #224

**Before:**
- `get_unusual_stocks` 결과에 Phase 2 + 당일 -5% 이상 급락 종목이 혼재.
- `systemPrompt.ts` Bull-Bias 가드레일: "Phase 분류-서술 일관성" 지시가 있으나 "당일 급락 종목을 추천에서 제외하라"는 명시 규칙이 없음.
- 에이전트가 약세 특이종목(`⚠️ 약세 경고`) 섹션에 Phase 2 급락주를 넣을지, 강세 섹션에 넣을지 자율 판단. 오판 발생.

**After:**
- `get_unusual_stocks` 도구가 반환 데이터에 `phase2WithDrop` 플래그를 추가. Phase 2인데 당일 -5% 이상 하락한 종목임을 명시적으로 표시.
- `systemPrompt.ts` 일간 `## 규칙`에 명시적 지시 추가: `phase2WithDrop: true` 종목은 반드시 `⚠️ 약세 경고` 섹션에만 포함, 강세/주도주 예비군 섹션에서 제외.
- 테스트: 도구 단위 테스트에서 플래그 생성 로직 검증.

### #229

**Before:**
- `publishStockReport`가 리포트 마크다운을 즉시 Gist 저장 + Discord 발송.
- 발행 후 문제 발견 시 CEO가 직접 Discord에서 확인하거나 수동 체크.

**After:**
- `publishStockReport`는 기존 그대로 실행 (Discord 발송 유지). 발행 흐름은 변경하지 않음.
- 발행 **직후** 별도로 QA 검출 함수 실행. 검출만 한다 — 리포트를 수정하지 않는다.
- 문제 발견 시 GitHub 이슈 자동 생성 (`report-feedback` 라벨).
- 이슈 없으면 통과. 에이전트 흐름을 막지 않는다.

## 변경 사항

---

### Phase 1 — #224: 당일 가격-Phase 일관성 강제

#### 1-A: `src/agent/tools/getUnusualStocks.ts` — `phase2WithDrop` 플래그 추가

`get_unusual_stocks` 쿼리가 반환하는 각 종목 객체에 다음 필드를 추가:

```
phase2WithDrop: boolean
```

**정의**: `phase === 2 && daily_return <= -0.05`인 경우 `true`.

SQL 변경 없이 TypeScript 레이어에서 계산 가능 (이미 `phase`와 `daily_return`을 반환 중).

구현 위치: `execute` 함수 내 결과 매핑 단계에서 플래그 계산 후 `JSON.stringify` 전 삽입.

**완료 기준:**
- `phase === 2 && daily_return <= -0.05`인 종목의 응답에 `"phase2WithDrop": true` 포함
- 나머지 종목은 `"phase2WithDrop": false`
- 기존 다른 필드 변경 없음

#### 1-B: `src/agent/systemPrompt.ts` — 일간 `## 규칙` 섹션에 명시적 차단 규칙 추가

`## 규칙` 섹션 내 기존 수치 규칙들 아래에 추가:

```
- **phase2WithDrop: true 종목 처리 규칙**: `get_unusual_stocks` 결과에서 `phase2WithDrop: true`인 종목은 Phase 2이지만 당일 -5% 이상 급락한 종목입니다. 이 종목은 반드시 `⚠️ 약세 경고` 섹션에만 포함하세요. 강세 특이종목, 주도주 예비군 섹션에 절대 포함하지 마세요. 서술은 "Phase 2이나 당일 급락 — 모멘텀 훼손 여부 확인 필요"로 시작하세요.
```

**완료 기준:**
- `buildDailySystemPrompt()` 출력에 `phase2WithDrop` 관련 규칙 문자열 존재
- 기존 규칙 구조 변경 없음

#### 1-C: 테스트 — `src/agent/tools/__tests__/getUnusualStocks.test.ts` 추가 또는 기존 확장

- `phase === 2 && daily_return === -0.06`인 목 데이터 → `phase2WithDrop: true` 검증
- `phase === 2 && daily_return === 0.03`인 목 데이터 → `phase2WithDrop: false` 검증
- `phase === 1 && daily_return === -0.06`인 목 데이터 → `phase2WithDrop: false` 검증

---

### Phase 2 — #229: S등급 종목 리포트 QA 검출 시스템

#### 설계 원칙

- **검출만 한다** — 리포트를 수정하지 않는다.
- **발행 흐름을 막지 않는다** — QA 실패가 발행을 중단시키지 않는다.
- **GitHub 이슈로 축적** — Discord 미발송. 이슈를 보고 프롬프트/로직을 근본 수정하는 사이클.
- **LLM 사용 없음** — 정규식/패턴 기반 체크. LLM-LLM 루프를 근본적으로 차단.

#### 2-A: `src/agent/fundamental/stockReportQA.ts` — 신규 파일

QA 검출 로직을 담는 전용 파일. LLM 없이 순수 문자열/패턴 분석.

**검출 항목:**

| 체크 ID | 설명 | 검출 방법 |
|---------|------|-----------|
| `MARGIN_RAW_DECIMAL` | 이익률이 0.1~0.9 범위 소수점으로 표기됨 (퍼센트 변환 미적용) | `\| 0\.[1-9]\d* \|` 패턴 탐색 (테이블 내 이익률 열) |
| `PHASE2_DROP_MISMATCH` | 기술적 현황 섹션에 Phase 2인데 "약세", "하락세", "급락", "부진" 서술 존재 | Phase 2 언급 이후 200자 내 금지 키워드 탐색 |
| `SECTION_MISSING` | 필수 섹션(기술적 현황/펀더멘탈 분석/분기별 실적/LLM 분석/종합 판단) 누락 | `## 1.`, `## 2.`, `## 3.`, `## 4.`, `## 5.` 존재 여부 |
| `NO_RISK_MENTION` | S등급 종목인데 리스크/주의 서술이 전혀 없음 | "리스크", "주의", "모멘텀 둔화", "경고", "확인 필요" 중 하나라도 없으면 플래그 |
| `EPS_INCONSISTENCY` | 테이블 EPS 수치와 LLM 분석 섹션 EPS 언급이 불일치 의심 (자동 정확 검출 불가, 구조 이상만 탐지) | 분기별 실적 테이블 행 수가 0이면 플래그 |

**인터페이스:**

```typescript
export interface QAIssue {
  checkId: string;
  severity: 'HIGH' | 'MEDIUM';
  description: string;
}

export interface QAResult {
  symbol: string;
  date: string;
  passed: boolean;   // 이슈 0개이면 true
  issues: QAIssue[];
}

export function runStockReportQA(
  symbol: string,
  reportMd: string,
): QAResult
```

순수 함수 — 비동기 없음, DB/LLM/외부 의존 없음.

#### 2-B: `src/agent/fundamental/stockReportQA.ts` — GitHub 이슈 생성 함수

QA 이슈를 GitHub 이슈로 생성하는 함수를 같은 파일에 추가.

```typescript
export async function reportQAIssueToGitHub(
  result: QAResult,
): Promise<void>
```

**구현 방향:**
- `gh` CLI를 `child_process.execFile`로 호출: `gh issue create --title "..." --body "..." --label "report-feedback"`
- `result.passed === true`이면 즉시 반환 (no-op)
- `gh` CLI가 없거나 실패하면 `logger.warn`으로만 기록 — 발행 흐름을 막지 않음
- 이슈 제목 형식: `[QA] ${symbol} 리포트 품질 이슈 (${date})`
- 이슈 본문: 검출된 `QAIssue` 목록을 마크다운 체크리스트로 포맷

**환경 변수 의존:**
- `GITHUB_TOKEN`: `gh` CLI가 이미 인증된 환경이면 불필요. 없으면 `gh auth status` 확인 후 warn.

#### 2-C: `src/agent/fundamental/runFundamentalValidation.ts` — QA 호출 추가

기존 `publishStockReport` 호출 이후에 QA 실행. **발행 흐름은 변경하지 않는다.**

```
// 현재
await publishStockReport(score.symbol, reportMd);
reportsPublished.push(score.symbol);

// 변경 후
await publishStockReport(score.symbol, reportMd);
reportsPublished.push(score.symbol);

// QA: 검출만, 발행 흐름에 영향 없음
try {
  const qaResult = runStockReportQA(score.symbol, reportMd);
  if (!qaResult.passed) {
    await reportQAIssueToGitHub(qaResult);
  }
} catch (qaErr) {
  logger.warn("Fundamental", `${score.symbol} QA 실행 실패 (계속 진행): ${qaErr}`);
}
```

에러가 발생해도 `catch`로 삼켜서 발행 흐름을 막지 않는다.

#### 2-D: 테스트 — `src/agent/fundamental/__tests__/stockReportQA.test.ts` 신규

**단위 테스트 (순수 함수이므로 mock 불필요):**

- `MARGIN_RAW_DECIMAL`: 테이블에 `| 0.23 |` 포함 시 이슈 검출
- `SECTION_MISSING`: `## 4.` 누락 시 이슈 검출
- `NO_RISK_MENTION`: "리스크" 등 키워드 없는 리포트 → 이슈 검출
- 정상 리포트 (5개 섹션 + 리스크 언급 + 정상 마진 표기) → `passed: true`

## 작업 계획

| Phase | 단계 | 수정/신규 파일 | 에이전트 | 완료 기준 |
|-------|------|---------------|---------|----------|
| 1 | 1-A: `phase2WithDrop` 플래그 | `getUnusualStocks.ts` | 실행팀 | 플래그 계산 로직 존재, 단위 테스트 통과 |
| 1 | 1-B: systemPrompt 규칙 추가 | `systemPrompt.ts` | 실행팀 | `buildDailySystemPrompt()` 출력에 규칙 문자열 존재 |
| 1 | 1-C: 도구 단위 테스트 | `getUnusualStocks.test.ts` | 실행팀 | 3개 케이스 green |
| 2 | 2-A+B: QA 검출 + 이슈 생성 | `stockReportQA.ts` (신규) | 실행팀 | `runStockReportQA` + `reportQAIssueToGitHub` export |
| 2 | 2-C: 파이프라인 호출 추가 | `runFundamentalValidation.ts` | 실행팀 | `publishStockReport` 이후 QA 호출, 에러 삼킴 |
| 2 | 2-D: QA 단위 테스트 | `stockReportQA.test.ts` (신규) | 실행팀 | 4개 케이스 green |

**병렬 실행 가능**: Phase 1(1-A~1-C)과 Phase 2(2-A~2-D)는 독립적이므로 동시 실행 가능.
Phase 2 내부에서는 2-A+B → 2-C → 2-D 순서 (의존성 있음).

## 리스크

- **`phase2WithDrop` 플래그의 임계값 (-5%)**: 현재 `BIG_MOVE_THRESHOLD = 0.05`가 이미 정의되어 있으므로 동일 상수 재사용. 일관성 유지.

- **GitHub 이슈 생성 실패**: `gh` CLI가 맥미니 서버에서 인증된 상태인지 확인 필요. 실패 시 warn 로그만 남기고 통과. 발행 흐름을 막지 않는 설계이므로 프로덕션 리스크 없음.

- **`PHASE2_DROP_MISMATCH` 오탐**: Phase 2 언급 후 200자 내 "약세" 키워드는 "Phase 2이나 약세 경고" 같은 의도적 서술에서도 발생. **severity를 `MEDIUM`으로 유지**하여 오탐이 이슈에 기록되더라도 심각도를 구분할 수 있게 함. 이슈를 직접 읽고 판단하는 사이클이므로 오탐 허용.

- **`NO_RISK_MENTION` 키워드 확장 필요 가능성**: 현재 5개 키워드("리스크", "주의", "모멘텀 둔화", "경고", "확인 필요"). 초기 운영 후 이슈 패턴을 보고 확장 여부 결정. 현재는 최소 범위로 시작.

## 의사결정 필요

없음 — 자율 판단 후 진행.

- **`phase2WithDrop` 임계값**: 기존 `BIG_MOVE_THRESHOLD = 0.05` 재사용으로 통일. 별도 논의 불필요.
- **GitHub 이슈 라벨**: `report-feedback`로 고정. 없으면 이슈 생성 시 자동 생성.
- **QA 실패 시 발행 중단 여부**: 중단하지 않는다 (CEO 방향과 일치). 검출 → 이슈 축적 → 근본 수정 사이클.
