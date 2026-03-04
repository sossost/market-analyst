# Implementation Plan: Data Infrastructure

**Status:** Draft
**Created:** 2026-03-04
**Spec:** ./01-spec.md

---

## Phase 1: Project Setup [Estimated: S]

- [ ] package.json 생성 (drizzle-orm, pg, tsx, typescript, dotenv, vitest)
- [ ] tsconfig.json 설정 (`@/` 경로 별칭, strict mode)
- [ ] drizzle.config.ts 설정
- [ ] .env.example 생성 (DATABASE_URL)
- [ ] .gitignore 설정 (node_modules, .env, dist)
- [ ] ETL 유틸리티 작성: retry.ts, common.ts, validation.ts, date-helpers.ts
  - screener 프로젝트 패턴 재사용, 필요한 것만 가져오기

**Verify:** `npx tsx src/db/client.ts`가 DB 연결 성공. `pnpm test`로 vitest 실행 확인.

---

## Phase 2: DB Schema + Migration [Estimated: S]

- [ ] src/db/schema/readonly.ts — screener 읽기 전용 테이블 정의
  - symbols (symbol, sector, industry, isActivelyTrading, isEtf)
  - daily_prices (symbol, date, close, rsScore)
  - daily_ma (symbol, date, ma20, ma50, ma100, ma200)
  - quarterly_financials (symbol, periodEndDate, revenue, netIncome, epsDiluted)
- [ ] src/db/schema/analyst.ts — 신규 테이블 3개 정의
  - stock_phases
  - sector_rs_daily
  - industry_rs_daily
- [ ] Drizzle 마이그레이션 생성 및 실행
- [ ] 인덱스 설정: (date, symbol), (date, sector), (date, industry)

**Verify:** `npx drizzle-kit push`로 테이블 생성. Supabase에서 3개 테이블 확인.

---

## Phase 3: Phase Detection Logic (TDD) [Estimated: M]

핵심 비즈니스 로직. 반드시 TDD로 진행.

- [ ] src/types/index.ts — PhaseInput, PhaseResult, PhaseDetail 타입 정의
- [ ] __tests__/lib/phase-detection.test.ts — 테스트 먼저 작성
  - Phase 2 조건 8개 모두 충족 → Phase 2
  - Phase 2 조건 중 하나라도 미충족 → Phase 2 아님
  - Phase 4 조건 (가격 < MA150, 하락 기울기, 낮은 RS)
  - Phase 1 조건 (횡보 기울기, MA150 근처)
  - Phase 3 조건 (나머지)
  - 경계값 테스트 (MA150 기울기 0 근처, RS 정확히 50)
  - MA150 직접 계산 검증
- [ ] src/lib/phase-detection.ts — 순수 함수 구현
  - `detectPhase(input: PhaseInput): PhaseResult`
  - `calculateMa150Slope(ma150Today: number, ma150_20dAgo: number): number`
  - 각 Phase 조건을 명시적 guard clause로 구현

**Verify:** `pnpm test -- phase-detection` 전체 통과. 커버리지 95%+.

---

## Phase 4: build-stock-phases ETL [Estimated: M]

- [ ] src/etl/jobs/build-stock-phases.ts 구현
  - 환경변수 검증
  - 전체 활성 종목 조회 (symbols WHERE isActivelyTrading AND NOT isEtf)
  - 배치 처리 (200 종목/배치)
  - 각 종목: daily_prices에서 최근 170일 close 조회 → MA150 직접 계산
  - 각 종목: daily_ma에서 ma50, ma200, 20일 전 데이터 조회
  - 각 종목: daily_prices에서 rs_score, 52주 고/저 조회
  - detectPhase() 호출
  - 전일 stock_phases와 비교 → Phase 전환 감지
  - stock_phases에 upsert (onConflictDoUpdate)
- [ ] backfill 모드 지원 (최근 60일 재계산)
- [ ] 통합 테스트: 실제 DB 데이터로 실행 확인

**Verify:** `npx tsx src/etl/jobs/build-stock-phases.ts` 실행 → stock_phases에 데이터 확인. 알려진 종목(AAPL, NVDA 등) Phase가 상식적인지 수동 검증.

---

## Phase 5: Group RS Engine (TDD) [Estimated: M]

- [ ] __tests__/lib/group-rs.test.ts — 테스트 먼저 작성
  - RS 평균 계산
  - 최소 종목 수 필터링
  - 가속도(변화율) 계산
  - 브레드스 4개 지표 계산
  - 펀더멘털 비율 계산
- [ ] src/lib/group-rs.ts — 공통 함수 구현
  - `buildGroupRs(config: GroupRsConfig): Promise<GroupRsRow[]>`
  - 내부 단계: RS 평균 → 랭킹 → 가속도 → 브레드스 → 전환급증 → 펀더멘털 → 그룹Phase
- [ ] __tests__/lib/group-phase.test.ts — 그룹 Phase 테스트
- [ ] src/lib/group-phase.ts — 그룹 Phase 판별
  - `detectGroupPhase(change4w, change8w, phase2Ratio): 1|2|3|4`

**Verify:** `pnpm test -- group-rs group-phase` 전체 통과.

---

## Phase 6: build-sector-rs + build-industry-rs ETL [Estimated: M]

- [ ] src/etl/jobs/build-sector-rs.ts 구현
  - buildGroupRs({ groupBy: 'sector', minStockCount: 10 })
  - sector_rs_daily에 upsert
- [ ] src/etl/jobs/build-industry-rs.ts 구현
  - buildGroupRs({ groupBy: 'industry', minStockCount: 5 })
  - industry_rs_daily에 upsert (sector 컬럼 포함)
- [ ] backfill 모드 지원
- [ ] 통합 테스트: 실제 DB 데이터로 실행 확인

**Verify:** 두 스크립트 실행 → sector_rs_daily에 11+ 행, industry_rs_daily에 50+ 행 확인. 섹터 RS 랭킹, 브레드스 값이 상식적인지 수동 검증.

---

## Phase 7: GitHub Actions + Validation [Estimated: S]

- [ ] .github/workflows/etl-daily.yml 작성
  - 스케줄: UTC 00:00 (screener ETL 완료 이후)
  - Job 1: build-stock-phases
  - Job 2a: build-sector-rs (depends on Job 1)
  - Job 2b: build-industry-rs (depends on Job 1, parallel with 2a)
  - Secrets: DATABASE_URL
- [ ] 실 데이터 검증 스크립트 작성 (src/etl/jobs/validate-data.ts)
  - 알려진 종목 Phase 검증 (AAPL → Phase 2 예상 등)
  - 섹터 RS 랭킹 상식 검증
  - Industry 분류에 null/빈값 있는 종목 수 집계
  - 브레드스 값 범위 확인 (0-100)
- [ ] README.md에 실행 방법 문서화

**Verify:** GitHub Actions 워크플로우가 수동 트리거로 성공. 검증 스크립트 통과.

---

## Dependencies

```
Phase 1 (Setup) ─────────────┐
                              ▼
Phase 2 (Schema) ────────────┐
                              ▼
Phase 3 (Phase Detection) ───┐
                              ▼
Phase 4 (build-stock-phases) ─┐
                               ▼
Phase 5 (Group RS Engine) ────┐
                               ▼
Phase 6 (build-sector/industry-rs)
                               ▼
Phase 7 (CI + Validation)
```

모든 Phase는 순차 의존. Phase 3과 Phase 5는 TDD (테스트 먼저).

---

## Risk Assessment

| Risk | Level | Mitigation |
|------|-------|------------|
| MA150이 screener DB에 없음 | MEDIUM | 직접 계산 (150일 close 평균). 쿼리당 150행 조회 필요하지만, 배치로 한번에 가져오면 문제 없음 |
| Industry 분류에 null/빈값 | HIGH | FMP symbols.industry가 비어있는 종목 존재 가능. 첫 실행 시 null 비율 체크 → null인 종목은 industry 계산에서 제외 |
| Phase 판별 임계치가 현실 데이터에 안 맞음 | MEDIUM | Phase 7에서 알려진 종목 검증. 임계치는 상수로 추출하여 쉽게 튜닝 가능하게 설계 |
| screener ETL 미완료 시 데이터 불일치 | MEDIUM | date-helpers로 latest trade date 조회하여 데이터 존재 여부 확인 후 실행. 없으면 skip |
| 52주 고/저 계산에 252 거래일 데이터 필요 | LOW | daily_prices에 이미 1년+ 데이터 있음. backfill 모드에서 확인 |
| Group RS 첫 실행 시 4w/8w/12w 가속도가 null | LOW | 이전 데이터 없으면 null 허용. Agent는 null 체크하고 조회. backfill로 히스토리 구축 |

---

## Estimated Complexity: M (Medium)

- 순수 로직 (Phase detection, Group RS)은 단순하지만 정확도 검증이 핵심
- ETL 패턴은 screener 재사용으로 보일러플레이트 최소화
- 가장 시간이 걸리는 부분: 실 데이터 검증 + Phase 임계치 튜닝
