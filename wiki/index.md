# Market Analyst Wiki

> LLM이 매 세션에서 프로젝트를 빠르게 이해하기 위한 컴파일된 지식 베이스.
> 이 위키는 LLM이 소유하고 유지한다. 인간은 raw 소스를 제공하고, LLM이 위키로 컴파일한다.

## Architecture (시스템 아키텍처)
- [data-pipeline.md](architecture/data-pipeline.md) -- 데이터 수집 -> 인사이트 생성 전체 파이프라인
- [report-layouts.md](architecture/report-layouts.md) -- 일간/주간 리포트 섹션 구성, 데이터 매핑, UI 컴포넌트

## Concepts (도메인 개념)
- [component-goals.md](concepts/component-goals.md) -- 9개 컴포넌트 세부 골 + 설계 원칙 (2026-04-16 확정)
- *(예정)* weinstein-phase.md -- Weinstein 4단계 Phase 판정 로직
- *(예정)* relative-strength.md -- RS 스코어 계산 및 활용
- *(예정)* sepa-scoring.md -- Minervini SEPA 펀더멘탈 등급
- *(예정)* market-regime.md -- 5단계 시장 레짐 분류 및 히스테리시스
- *(예정)* narrative-chain.md -- 병목 체인 생애주기 추적

## Entities (테이블/컴포넌트)
- *(예정)* db-schema.md -- 37개 테이블 도메인별 분류 및 관계
- *(예정)* agent-tools.md -- Agent 도구 목록 및 DB 매핑

## Operations (운영)
- *(예정)* schedules.md -- 스케줄, 실행 순서, launchd 설정
- *(예정)* troubleshooting.md -- 자주 발생하는 문제와 해결 패턴
