# Spec: SEPA 데이터 품질 방어 로직

## Purpose

FMP API가 제공하는 분기 실적 데이터에는 누적 vs 단독 분기 혼재, 단위 불연속, 업종 부적합 지표 등의 오염 패턴이 존재한다.
현재 SEPA 스코어러(`fundamental-scorer.ts`)는 이러한 이상 데이터를 그대로 받아 S/A 등급을 산출하며, 오염된 등급이 리포트에 포함되어 추천 품질을 훼손한다.
이 기능은 스코어러 레벨에서 데이터 이상을 감지하고 신뢰할 수 없는 종목의 등급을 N/A로 격리하는 방어 로직을 도입한다.

## Requirements

### Functional

- [ ] **연속 분기 급변 감지**: 인접 분기(QoQ) 매출 또는 EPS가 5배 이상 급변하면 누적 실적 혼입 의심으로 플래그
- [ ] **YoY 이상값 캡**: YoY 성장률이 +1000% 초과인 경우 신뢰 불가 → 해당 기준 항목 N/A 처리
- [ ] **단위 불연속 감지**: 연속 분기 간 매출/순이익의 절댓값이 10배 이상 점프하면 단위 변경 의심으로 플래그
- [ ] **금융섹터 격리**: symbols.sector가 'Financial Services' 또는 'Financials'인 종목은 SEPA 스코어링 대상에서 제외. 등급 N/A로 저장
- [ ] **N/A 등급 타입 추가**: `FundamentalGrade`에 `"N/A"` 추가. N/A 종목은 `promoteTopToS` 후보에서 제외
- [ ] **data_quality_flags 필드 추가**: 어떤 이상이 감지되었는지 `FundamentalScore`에 배열로 포함
- [ ] **기존 오염 스코어 무효화**: 기능 배포 시 `fundamental_scores` 테이블에서 해당 종목들의 기존 스코어를 N/A로 덮어쓰기 (migration script)

### Non-Functional

- [ ] 이상 감지 로직은 순수 함수로 구현 (LLM 의존 없음)
- [ ] 기존 단위 테스트(`fundamental-scorer.test.ts`) 전부 통과 유지
- [ ] 신규 방어 로직 단위 테스트 커버리지 80% 이상
- [ ] 스코어링 성능: 종목당 감지 로직 추가 후에도 배치 처리 시간 5% 이하 증가

## Scope

**In scope:**
- `fundamental-scorer.ts`: 데이터 품질 감지 함수 + N/A 등급 처리
- `fundamental-data-loader.ts`: 로드 시점에 섹터 정보 포함
- `types/fundamental.ts`: `FundamentalGrade`, `FundamentalScore` 타입 확장
- `runFundamentalValidation.ts`: N/A 등급 처리 흐름 조정 (LLM 분석 건너뜀)
- 마이그레이션 스크립트: 기존 오염 스코어 무효화

**Out of scope:**
- ETL 레벨에서 데이터 원본 수정 (FMP API 응답 변환)
- 금융섹터 전용 스코어링 로직 (별도 기준 적용)
- 일본/비표준 회계연도 기업에 대한 별도 분기 보정
- ROE 데이터 확보 (기존 TODO 유지)

## Design

### 데이터 플로우 변경

```
[기존]
loadFundamentalData(symbols)
  → QuarterlyData[]
  → scoreFundamentals()
  → FundamentalScore { grade: S/A/B/C/F }

[변경 후]
loadFundamentalData(symbols, { withSector: true })
  → FundamentalInput { symbol, quarters, sector? }
  → detectDataQualityIssues(input)  ← 신규
      → DataQualityFlag[]
  → if (flags.length > 0 || isFinancialSector) → grade: "N/A"
  → else → scoreFundamentals() (기존과 동일)
  → FundamentalScore { grade: S/A/B/C/F/N/A, dataQualityFlags: [] }
```

### 신규 타입

```typescript
type DataQualityFlag =
  | 'QOQ_SPIKE'           // 인접 분기 5배 이상 급변
  | 'UNIT_DISCONTINUITY'  // 절댓값 10배 이상 점프
  | 'YOY_EXTREME'         // YoY 성장률 +1000% 초과
  | 'FINANCIAL_SECTOR'    // 금융섹터 제외 대상

// FundamentalGrade에 "N/A" 추가
type FundamentalGrade = "S" | "A" | "B" | "C" | "F" | "N/A"

// FundamentalInput에 sector 추가
interface FundamentalInput {
  symbol: string
  quarters: QuarterlyData[]
  sector?: string   // ← 신규
}

// FundamentalScore에 flags 추가
interface FundamentalScore {
  // ... 기존 필드 유지
  dataQualityFlags: DataQualityFlag[]  // ← 신규, 정상이면 []
}
```

### 이상 감지 임계값

| 감지 유형 | 임계값 | 근거 |
|-----------|--------|------|
| QoQ 급변 | 5배 이상 변화 (1/5 이하 포함) | 누적 → 단독 전환 시 ~4x 감소가 전형적 패턴 |
| 단위 불연속 | 연속 분기 절댓값 10배 이상 점프 | 통화 단위 변경(예: 엔화 백만 → 엔화 단순) |
| YoY 이상 | +1000% 초과 | 오염 없이 실제 10배 성장은 극히 드묾 |
| 금융섹터 | sector in ('Financial Services', 'Financials', 'Banks', 'Insurance') | SEPA는 성장주 기준 — 금융주에 부적합 |

### 섹터 정보 로드

`fundamental-data-loader.ts`에서 `symbols.sector`를 JOIN으로 함께 로드한다.
기존 쿼리에 `s.sector` 컬럼 추가. `FundamentalInput.sector` 필드로 전달.

### N/A 등급 처리 흐름 (runFundamentalValidation)

- N/A 종목은 LLM 분석(`analyzeFundamentals`) 건너뜀
- N/A 종목은 `promoteTopToS` 후보 제외 (기존 필터가 `grade === "A"` 조건이므로 자동 제외)
- N/A 종목도 DB 저장됨 (추적 및 모니터링 목적)
- `formatFundamentalSupplement`에서 N/A 등급은 별도 섹션으로 표시 (`⚪ N/A N개 — 데이터 품질 문제`)

## API

변경 없음 (내부 로직 변경만).

## Error Handling

| 시나리오 | 처리 |
|----------|------|
| sector 정보 없음 (NULL) | 감지 대상 제외, 기존 스코어링 그대로 진행 |
| 분기 데이터 1~2개뿐 | QoQ/단위 감지 건너뜀 (비교 불가), 기존 MIN_QUARTERS 로직 유지 |
| N/A 종목 DB 저장 시 에러 | 로그 경고 후 계속 진행 |

## Acceptance Criteria

- [ ] SMFG와 같은 일본 금융주가 N/A 등급으로 산출됨
- [ ] 정상 미국 성장주(예: NVDA, CELH)는 기존 등급 유지
- [ ] N/A 종목이 S등급 리포트에 포함되지 않음
- [ ] `dataQualityFlags` 필드에 해당 감지 사유가 기록됨
- [ ] 마이그레이션 스크립트 실행 후 기존 금융섹터 종목 스코어가 N/A로 갱신됨

## Open Questions

없음 — 02-decisions.md에서 모든 의사결정 사항 해소됨
