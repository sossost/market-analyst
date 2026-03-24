# Plan: 리포트 품질 이슈 — 전일 비교 누락 및 팩트 불일치

**이슈**: #417
**트랙**: Lite (버그픽스/품질 개선)
**골 정렬**: SUPPORT — Phase 2 주도섹터/주도주 초입 포착 목표의 리포트 품질 기반. 전일 대비 변화 추적이 없으면 Phase 전이 시그널을 놓침.
**무효 판정**: 해당 없음 (LLM 백테스트 아님, 실제 코드 개선)

## 문제 정의

2026-03-23 일간 리포트에서 4가지 품질 이슈 발생:

1. **"전일 데이터 없음" 오인**: 3/20 리포트 존재하나 에이전트가 "첫 브리핑"으로 판단. `read_report_history` 도구가 file-system 기반이라 DB 리포트를 못 찾거나, 에이전트가 도구를 호출하지 않음.
2. **티커-회사명 불일치**: EXE 티커에 Exelixis(실제 EXEL)와 Exelon(실제 EXC) 다른 이름 부여. LLM 환각 — `get_unusual_stocks` 결과의 `companyName`이 DB에서 오지만, 에이전트가 무시하고 자체 생성.
3. **섹터 Phase 변화 미언급**: `get_leading_sectors`가 `groupPhase`와 `prevGroupPhase`를 반환하나, 시스템 프롬프트에 Phase 변화 감지 지시 없음.
4. **SCCD 회사명 누락**: `get_unusual_stocks`가 `companyName`을 반환하나 프롬프트에 "반드시 `티커 (회사명)` 형식으로" 지시 없음.

## Before → After

| 항목 | Before | After |
|------|--------|-------|
| 전일 리포트 컨텍스트 | 에이전트가 `read_report_history` 자율 호출 (file-only) | DB 기반으로 직전 리포트 요약을 시스템 프롬프트에 주입 |
| 티커-회사명 | LLM이 자체 생성 가능 | 프롬프트에 "반드시 도구 결과의 companyName 사용" 지시 |
| 섹터 Phase 변화 | 언급 안 됨 | 프롬프트에 "groupPhase ≠ prevGroupPhase 시 반드시 서술" 지시 |
| 종목 표기 형식 | 일부 회사명 누락 | 프롬프트에 "티커 (회사명)" 형식 강제 |
| read_report_history | file-system only | DB fallback 추가 |

## 변경 사항

### 1. `read_report_history` 도구 — DB fallback 추가
- **파일**: `src/tools/readReportHistory.ts`
- file-system `readReportLogs` 결과가 비어있으면 `readReportLogsFromDb` fallback
- 직전 리포트의 `reportedSymbols`와 `marketSummary`를 반환 (기존 동작 유지)

### 2. 직전 리포트 컨텍스트 주입
- **파일**: `src/agent/run-daily-agent.ts`
- 새 함수 `loadPreviousReportContext(targetDate)`: DB에서 직전 daily 리포트를 조회하여 핵심 요약(주도 섹터, 특이종목 리스트, 섹터 Phase 상태) 생성
- **파일**: `src/agent/systemPrompt.ts`
- `buildDailySystemPrompt`에 `previousReportContext?: string` 옵션 추가
- "전일 대비 변화 요약" 섹션 지시문에 직전 리포트 데이터 참조 지시 추가

### 3. 시스템 프롬프트 품질 가드레일 강화
- **파일**: `src/agent/systemPrompt.ts`
- 섹터 Phase 변화 감지 지시: "groupPhase ≠ prevGroupPhase인 섹터는 반드시 Phase 변화를 서술"
- 티커-회사명 규칙: "종목 언급 시 반드시 `TICKER (회사명)` 형식. companyName은 도구 결과 값을 그대로 사용. 자체 추측 금지"
- "전일 데이터 없음" 조건 명확화: "read_report_history 결과가 비어있고 <previous-report> 컨텍스트도 없을 때만"

### 4. 직전 리포트 컨텍스트 로더 함수
- **파일**: `src/lib/previousReportContext.ts` (신규)
- DB에서 직전 daily 리포트를 조회하여 structured context string 생성
- 포함: 주도 섹터 top 2, 특이종목 리스트 (symbol, phase, sector), marketSummary

## 작업 계획

1. `src/lib/previousReportContext.ts` 생성 + 테스트
2. `src/tools/readReportHistory.ts` DB fallback 추가 + 테스트
3. `src/agent/systemPrompt.ts` 프롬프트 강화
4. `src/agent/run-daily-agent.ts` 직전 리포트 컨텍스트 주입
5. 전체 테스트 실행 + 커버리지 확인

## 리스크

- **토큰 증가**: 직전 리포트 컨텍스트가 ~200-500 토큰 추가. 허용 범위.
- **DB 접근 실패**: fail-open 패턴 — DB 실패 시 빈 컨텍스트로 진행 (기존 동작과 동일).
