# Daily Strategic Review — Claude Code CLI 기반 자율 전략 참모

## 골 정렬

**ALIGNED** — 프로젝트 골(Phase 2 주도주 포착)에 직접 기여.
시스템이 골을 향해 올바르게 진화하는지 매일 점검하고, 맹점/갭을 이슈화한다.

## 설계

### 핵심 원칙

TypeScript 모듈이 아니라 **Claude Code CLI**가 직접 프로젝트를 분석한다.
- Claude Code는 프로젝트 컨텍스트(CLAUDE.md, agents 등)를 자동 로드
- 파일 읽기, DB 쿼리, `gh issue create` 등을 자율적으로 수행
- Claude Max 구독이라 토큰 비용 없음

### 전체 흐름

```
[launchd: KST 04:00 매일]
        │
        ▼
scripts/cron/strategic-review.sh
        │
        ├── git pull
        ├── cat 프롬프트 | claude -p --dangerously-skip-permissions
        │
        ▼
Claude Code CLI가 자율적으로:
        ├── 코드 파일 읽기 (포착 로직, 에이전트 프롬프트, 토론 엔진 등)
        ├── DB 쿼리 실행 (agent_learnings, theses, market_regimes 등)
        ├── 8개 영역 분석 (코드 레벨 6개 + 결과물 레벨 2개)
        ├── 인사이트 품질 필터링
        ├── 기존 이슈 중복 체크 (gh issue list)
        └── 가치 있는 인사이트만 gh issue create
```

### 파일 구성

```
scripts/
├── strategic-review-prompt.md                          ← 프롬프트
├── cron/strategic-review.sh                            ← 실행 스크립트
└── launchd/com.market-analyst.strategic-review.plist   ← 스케줄
```

## 8개 분석 영역

매일 전부 실행. 로테이션 없음.

### 코드 레벨 (6개)
1. **포착 로직 감사** — phase-detection, getRisingRS, getPhase1LateStocks 등의 파라미터/임계값 검토
2. **학습 루프 건강도** — agentLearnings 근거 충분성, thesis HOLD 지연, 자기참조 루프 징후
3. **에이전트 프롬프트 맹점** — 토론 에이전트 페르소나가 놓치는 시장 분석 관점
4. **토론 엔진 구조** — 3라운드 구조, 레짐 분류, 서사 체인 정합성
5. **데이터 소스 갭** — Phase 2 포착에 유효하지만 현재 없는 신호 식별
6. **시장 구조 정합성** — 최근 시장 흐름과 시스템 설계 가정의 일치 여부

### 결과물 레벨 (2개)
7. **추천 종목 성과 분석** — 승률, 섹터별 실패 패턴, Phase 2 진입 정확도, 청산 타이밍
8. **Thesis 적중률 분석** — 에이전트별/confidence별/category별 적중률, 실패 패턴

> 개별 리포트 품질(팩트, 편향, 구조)은 QA(`validate-*.sh`)가 담당. 여기서는 **성과 패턴과 적중률 통계**만 다룬다.

## 이슈 생성 기준

- 1회 최대 3건
- 라벨: `strategic-review` + `P1`/`P2`
- 중복 체크: `gh issue list --label strategic-review --state open`
- 품질 기준: 구체적 파일 지목 + 골 연결 + 실행 가능한 개선안 + 근거

## 리스크

| 리스크 | 대응 |
|--------|------|
| LLM 자기참조 | 비즈니스 로직 정확성 판단 금지. 구조/갭/조건값만 |
| 이슈 노이즈 | 1일 3건 제한 + 품질 필터 |
| 중복 이슈 | gh issue list로 사전 체크 |
