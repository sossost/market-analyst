# Plan: agent/ 모듈 분리 리팩터링

**이슈:** #211
**유형:** Lite 트랙 (구조 리팩터링, 기능 변경 없음)
**골 정렬:** SUPPORT — Phase 2 주도섹터/주도주 포착과 직접 관련은 없으나, 모듈 분리로 유지보수성·개발 속도 개선
**무효 판정:** 해당 없음 (LLM 백테스트, 파라미터 최적화 등 무효 패턴 아님)

---

## 문제 정의

`src/agent/`가 전체 `src/`의 53% (123/232 파일)를 차지.
독립적 관심사(debate, tools, fundamental, corporateAnalyst, lib)가 하나의 디렉토리에 혼재.

### 핵심 문제
1. **비대화**: agent/ 안에 5개 독립 도메인이 혼재 → 코드 탐색·변경 비용 증가
2. **logger 의존성 역전**: `@/agent/logger`가 38개 파일에서 import → agent가 아닌 파일들이 agent에 의존
3. **Anthropic 클라이언트 분산**: 3곳에서 각각 생성 → 설정 일관성 부재

### 범위 제외 (별도 이슈)
- `pool.query` → Repository 패턴 전환: 로직 변경 수반하므로 이번 PR에서 제외
- Tool 보일러플레이트 통합: 기능적 변경 수반하므로 이번 PR에서 제외

---

## Before → After

### Before
```
src/agent/           123 files (53% of src/)
├── debate/           39 files (독립 도메인)
├── tools/            33 files (독립 도메인)
├── fundamental/       7 files (독립 도메인)
├── corporateAnalyst/  8 files (독립 도메인)
├── lib/              10 files (공유 유틸)
├── __tests__/         7 files
└── *.ts              19 files (오케스트레이터+코어)
```

### After
```
src/
├── agent/            25 files (오케스트레이터+코어만, 80% 감소)
│   ├── __tests__/     7 files
│   └── *.ts          18 files
├── debate/           39 files (독립 모듈)
├── tools/            33 files (독립 모듈)
├── fundamental/       7 files (독립 모듈)
├── corporate-analyst/ 8 files (독립 모듈, kebab-case 정규화)
├── lib/              29 files (기존 19 + agent/lib 5 + agent/lib/__tests__ 5)
├── etl/
├── db/
└── types/
```

---

## 변경 사항

### Phase 1: logger 의존성 정리
- `@/agent/logger` → `@/lib/logger`로 전체 코드베이스 일괄 변경 (38+ 파일)
- `src/agent/logger.ts` (deprecated re-export) 삭제

### Phase 2: debate/ 추출
- `src/agent/debate/` → `src/debate/`로 디렉토리 이동
- 내부 상대경로 import → `@/` 절대경로로 변환
- 외부 참조 (`@/agent/debate/...`) → `@/debate/...`로 변경

### Phase 3: tools/ 추출
- `src/agent/tools/` → `src/tools/`로 디렉토리 이동
- 동일한 import 경로 업데이트

### Phase 4: fundamental/ 추출
- `src/agent/fundamental/` → `src/fundamental/`로 디렉토리 이동

### Phase 5: corporateAnalyst/ 추출
- `src/agent/corporateAnalyst/` → `src/corporate-analyst/`로 이동 (kebab-case 정규화)

### Phase 6: agent/lib/ 통합
- `src/agent/lib/` 파일들을 `src/lib/`로 병합
- 충돌하는 파일명 없음 확인 완료 (agent/lib: reportValidator, factChecker, crossReportValidator, priceDeclineFilter, qaIssueReporter)

### Phase 7: Anthropic 클라이언트 팩토리
- `src/lib/anthropic-client.ts` 생성: 싱글턴 패턴으로 Anthropic 클라이언트 제공
- 3곳 (agentLoop.ts, corporateAnalyst.ts, anthropicProvider.ts) 변경

---

## 리스크

| 리스크 | 대응 |
|--------|------|
| Import 경로 누락으로 런타임 오류 | TypeScript 컴파일(`tsc --noEmit`)로 전수 검증 |
| 테스트 경로 깨짐 | vitest가 tsconfigPaths 플러그인 사용 → path alias 자동 해소 |
| 순환 의존성 발생 | 이동 후 tsc로 검증, 문제 시 re-export로 해소 |
| agent/ 내부 상대경로 참조 깨짐 | Phase별 grep으로 잔여 참조 전수 확인 |

---

## 작업 계획

1. Phase 1~7 순차 실행 (각 Phase는 독립적이나, import 경로 일관성을 위해 순차)
2. 전체 완료 후 `npx tsc --noEmit` 컴파일 검증
3. `npx vitest run` 테스트 검증
4. 커버리지 80% 이상 확인
