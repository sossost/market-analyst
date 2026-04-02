# narrative-chain-fix

## 선행 맥락

- 이슈 #565
- Sector Alpha Gate(#358, 3/20 머지)에서 `alpha_compatible` 컬럼을 Drizzle 스키마에 추가했으나, `0023_sector_alpha_gate.sql` 마이그레이션이 DB에 실제 적용되지 않음
- 메모리에 관련 기록 없음

## 골 정렬

SUPPORT — 데이터 파이프라인 무결성 복구. narrative_chains가 3/21부터 연결 안 된 상태로 thesis 컨텍스트 주입이 14일치 누락됨. Phase 2 포착 에이전트의 핵심 인풋 손상이므로 즉시 복구 필요.

## 문제

Sector Alpha Gate 배포 후 마이그레이션 미적용으로 `narrative_chains` insert/update 시 `alpha_compatible` 컬럼 부재 오류 발생. `try-catch`에 삼켜져 3/21부터 13일간 알림 없이 silent fail. 추가로 `allTickersEmpty` 경고가 `structural_narrative` 외 카테고리까지 체크해 false positive 경고 발송 중.

## Before → After

**Before**
- `narrative_chains` 테이블에 `alpha_compatible` 컬럼 없음 → `beneficiarySectors.length > 0`인 모든 thesis insert/update 실패
- `catch` 블록이 `logger.warn`만 남기고 Discord 알림 없음 → 운영팀 인지 불가
- `allTickersEmpty` 체크가 전체 카테고리 대상 → `sector_rotation`, `short_term_outlook` thesis에서 매 토론마다 false positive 경고 발송

**After**
- `alpha_compatible` 컬럼 DB에 존재 → insert/update 정상 동작
- `catch` 블록이 Discord 경고까지 발송 → 향후 유사 장애 즉시 인지
- `allTickersEmpty` 체크가 `structural_narrative` 카테고리에만 적용 → false positive 제거

## 변경 사항

### 1. DB 마이그레이션 실행
- `0023_sector_alpha_gate.sql` (`ALTER TABLE "narrative_chains" ADD COLUMN "alpha_compatible" boolean`)이 이미 존재하나 DB 미적용
- `yarn db:migrate` (= `npx tsx src/db/migrate.ts`) 실행으로 컬럼 추가
- `migrate.ts`는 `42701`(column already exists) 코드를 idempotent 처리하므로 중복 실행 안전

### 2. `recordNarrativeChain` catch 블록 강화
파일: `src/debate/narrativeChainService.ts` (L266~272)

```typescript
// 현재
} catch (err) {
  const reason = err instanceof Error ? err.message : String(err);
  logger.warn(
    "NarrativeChain",
    `Chain recording failed for thesis #${thesisId} (thesis saved successfully): ${reason}`,
  );
}

// 수정 후
} catch (err) {
  const reason = err instanceof Error ? err.message : String(err);
  logger.warn(
    "NarrativeChain",
    `Chain recording failed for thesis #${thesisId} (thesis saved successfully): ${reason}`,
  );
  await sendDiscordMessage(
    `⚠️ **[NarrativeChain 장애]** thesis #${thesisId} chain 연결 실패\n\`\`\`${reason}\`\`\``,
  ).catch(() => {
    // Discord 발송 실패는 무시 — 원본 오류 은폐 방지
  });
}
```

- `sendDiscordMessage` import 추가: `import { sendDiscordMessage } from "@/lib/discord";`

### 3. `allTickersEmpty` false positive 수정
파일: `src/agent/run-debate-agent.ts` (L694~704)

```typescript
// 현재 — 전체 카테고리 대상
const allTickersEmpty = result.round3.theses.length > 0 &&
  result.round3.theses.every((t) => (t.beneficiaryTickers ?? []).length === 0);

// 수정 후 — structural_narrative만
const structuralTheses = result.round3.theses.filter(
  (t) => t.category === "structural_narrative",
);
const allTickersEmpty = structuralTheses.length > 0 &&
  structuralTheses.every((t) => (t.beneficiaryTickers ?? []).length === 0);
```

### 4. 데이터 복구 (이번 범위 제외)
- 3/21~4/1 기간 누락된 14건 structural_narrative thesis의 narrative_chains 재연결은 복잡도 높음 (토론 세션 재파싱 필요)
- 이번 PR에서 제외하고 별도 이슈로 트래킹

## 작업 계획

| 단계 | 내용 | 에이전트 | 완료 기준 |
|------|------|----------|----------|
| 1 | DB 마이그레이션 실행 | 구현팀 | `\d narrative_chains`에서 `alpha_compatible` 컬럼 확인 |
| 2 | catch 강화 (`narrativeChainService.ts`) | 구현팀 | Discord import 추가 + catch 블록 수정 |
| 3 | false positive 수정 (`run-debate-agent.ts`) | 구현팀 | structural_narrative 필터 적용 |
| 4 | 코드 리뷰 | code-reviewer | CRITICAL/HIGH 이슈 없음 |
| 5 | PR 생성 | pr-manager | PR URL 반환 |

단계 2, 3은 독립적이므로 병렬 실행 가능.

## 리스크

- **마이그레이션 이미 적용됐을 가능성**: `migrate.ts`가 `42701` 코드를 idempotent 처리하므로 이중 실행 안전. 단, 실행 전 SSH로 맥미니 DB 상태 확인 권장.
- **Discord 발송 실패**: catch 내부의 sendDiscordMessage가 실패해도 `.catch(() => {})` 처리로 원본 오류 영향 없음.
- **데이터 복구 보류**: 14건 누락은 thesis 컨텍스트 품질에 영향. 포착 정확도 저하 가능성 있으나, 복구는 별도 이슈에서 처리.

## 의사결정 필요

없음 — 바로 구현 가능.

단, 데이터 복구(14건) 우선순위는 CEO가 판단 필요. 현재 범위에서 제외했지만 Phase 2 포착 컨텍스트 누락이므로 P2 이슈로 등록 권장.
