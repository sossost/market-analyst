# 투자 브리핑(토론) 사후 검증 파이프라인

## 선행 맥락

- PR #180: 일간/주간/펀더멘탈 리포트 사후 검증 시스템 신설. 동일 패턴(get-latest → Claude CLI → gh issue)으로 3종 검증 확립.
- PR #196: 투자 브리핑 품질 개선 — 펀더멘탈 연동 + 서사 근거 강화. 브리핑 구조가 확정됨.
- PR #200/#202: bull-bias 정량 기준 도입 (70:30 낙관/비관 비율).
- **투자 브리핑만 사후 검증 없음** — 이번 PR에서 완성.

## 골 정렬

ALIGNED. 투자 브리핑은 주도섹터/주도주 포착의 핵심 아웃풋이다. 검증 부재는 시스템이 맹점을 방치하는 것과 같다. 품질 가드 신설은 알파 형성 루프의 피드백 고리를 닫는다.

## 문제

투자 브리핑(Round 3 synthesis)은 하루 한 번 생성되어 Discord 발송되지만, 발송 후 품질을 점검하는 장치가 없다. bull-bias, thesis 근거 미흡, 애널리스트 다양성 부재 등의 문제가 조용히 누적된다.

## Before → After

**Before**: 토론 완료 → Discord 발송 → 끝. 품질 이슈 발생 시 육안으로 발견해야 함.

**After**: 토론 완료 → Discord 발송 → `validate-debate-report.sh` 자동 실행 → Claude CLI 검증 → 점수 미달 시 GitHub 이슈 자동 생성.

## 변경 사항

### 1. `src/scripts/get-latest-debate-report.ts` (신규)

`debate_sessions` 테이블에서 최신 세션 2건(오늘 + 직전)을 조회하여 stdout으로 JSON 출력.

```
출력 구조:
{
  "today": { "date": "2026-03-13", "content": "<synthesisReport>" },
  "prev": { "date": "2026-03-12", "content": "<synthesisReport>" } | null
}
```

- 기존 `get-latest-report.ts` 패턴 그대로 따름
- `debate_sessions.synthesisReport` 컬럼에서 리포트 본문 추출
- `debate_sessions.thesesCount`, `debate_sessions.round1Outputs` 는 검증 프롬프트 내 추가 컨텍스트로 포함 (thesis 수, 애널리스트 참여 확인)

### 2. `scripts/validate-debate-report-prompt.md` (신규)

투자 브리핑 전용 검증 프롬프트. 4개 항목, 각 10점, 총 40점.

**검증 항목:**

| 항목 | 키 | 기준 |
|------|-----|------|
| thesis 근거 충분성 | `thesisBasis` | 각 thesis가 시장 데이터/섹터 RS/Phase 변화에 근거하는가. "상승 가능성" 같은 근거 없는 주장 감점. |
| bull-bias 필터 | `bullBias` | 낙관/비관 언급 비율 ≤ 70:30. 리스크 섹션 존재 여부. 데이터 없는 낙관 감점. |
| 애널리스트 다양성 | `analystDiversity` | 4개 페르소나(매크로/테크/지정학/심리) 관점이 핵심 요약에 균형 있게 반영되는가. 단일 페르소나 편중 감점. |
| 구조/가독성 | `structure` | 브리핑 구조 준수 (핵심 요약 → 구조적 발견 → 섹터 전망 → 리스크). 핵심 정보가 상단에 있는가. |
| (선택) 이전 대비 변화 | `novelty` | 직전 브리핑 대비 새 인사이트가 있는가. 없으면 null. |

**hasIssue 기준**: 어느 하나라도 6점 미만이거나 totalScore ≤ 28 (1~4번 항목 합산, novelty 제외)

**자율 판단 근거**: 일간 리포트와 동일한 40점 만점 체계를 채택. 투자 브리핑은 thesis 중심이므로 `thesisBasis`를 `factConsistency` 대신 투입. `analystDiversity`는 5인 토론 시스템의 품질 지표로 브리핑 특화 항목.

### 3. `scripts/cron/validate-debate-report.sh` (신규)

기존 `validate-daily-report.sh`와 동일한 골격. 차이점:

- `get-latest-debate-report.ts` 로 데이터 조회 (`debateSessions` 테이블)
- 로그: `logs/validate-debate-YYYY-MM-DD.log`
- QA 저장: `data/report-qa/debate-YYYY-MM-DD.json`
- 이슈 제목 포맷: `"투자 브리핑 품질 이슈 — {REPORT_DATE} (점수: {SCORE}/40)"`
- P1/P2 우선순위 결정: `thesisBasis`, `bullBias`, `structure` 중 하나라도 3점 미만이면 P1

### 4. `scripts/cron/debate-daily.sh` 수정

토론 에이전트 완료 후 검증 스크립트 호출 추가.

```bash
# 기존 마지막 부분
if npx tsx src/agent/run-debate-agent.ts >> "$LOG_FILE" 2>&1; then
  log "=== 토론 에이전트 완료 ==="
  # 추가: 사후 검증
  log "▶ 투자 브리핑 사후 검증 시작"
  "$SCRIPT_DIR/validate-debate-report.sh" || log "✗ 사후 검증 실패 (토론 결과에 영향 없음)"
else
  ...
fi
```

검증 실패해도 토론 결과에 영향 없도록 `||` 로 처리 (기존 패턴과 동일).

## 작업 계획

### 단계 1 — DB 조회 스크립트 (구현팀)

**파일**: `src/scripts/get-latest-debate-report.ts`

**완료 기준**:
- `debate_sessions` 테이블에서 최신 2건 조회
- `synthesisReport`(리포트 본문) + `date` + `thesesCount` 출력
- 세션 없으면 `"null"` 출력
- 직전 세션(`prev`) 있으면 포함, 없으면 `null`

### 단계 2 — 프롬프트 파일 (구현팀)

**파일**: `scripts/validate-debate-report-prompt.md`

**완료 기준**:
- 4+1 검증 항목 명확하게 정의
- 출력 JSON 스키마 정의 (기존 프롬프트와 동일 구조)
- `{REPORT_DATE}`, `{REPORT_CONTENT}`, `{PREV_DATE}`, `{PREV_REPORT_CONTENT}` 플레이스홀더 포함

### 단계 3 — 검증 쉘 스크립트 (구현팀)

**파일**: `scripts/cron/validate-debate-report.sh`

**완료 기준**:
- `validate-daily-report.sh` 패턴 준수 (timeout, trap, mktemp, python3 치환)
- `VALIDATE_DRY_RUN=1` 지원
- P1/P2 우선순위 로직 구현
- 실행 권한 설정 (`chmod +x`)

### 단계 4 — debate-daily.sh 수정 (구현팀)

**파일**: `scripts/cron/debate-daily.sh`

**완료 기준**:
- 토론 성공 후 `validate-debate-report.sh` 호출
- 검증 실패해도 스크립트 전체 실패하지 않음 (`||` 처리)

## 리스크

- `debate_sessions.synthesisReport`는 Gist에 업로드되는 마크다운. 긴 텍스트(3000~5000자)이므로 Claude CLI 처리 시 토큰 비용 발생. 기존 일간 리포트와 유사한 수준이므로 수용 범위 내.
- 알림 발송 조건(`checkAlertConditions`)에 따라 브리핑이 매일 생성되지 않을 수 있음. 세션은 항상 저장되므로 `synthesisReport`는 존재. 검증은 매일 실행 가능.
- `round1Outputs`(JSON)에서 페르소나별 출력을 파싱해 다양성 판단에 활용하면 이상적이나, 검증 프롬프트 내 처리 복잡도가 증가함. **자율 판단**: `synthesisReport` 본문만으로 다양성을 간접 평가. 4개 페르소나의 관점(매크로/테크/지정학/심리)이 핵심 요약에 반영되어 있는지를 텍스트에서 읽는 것으로 충분.

## 의사결정 필요

없음 — 바로 구현 가능.
