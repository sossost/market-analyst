# Feature Spec: Agent Core

**Status:** Confirmed
**Created:** 2026-03-04
**Author:** brainstorm session

---

## Overview

Claude Opus 4.6이 매일 ETL 완료 후 자율적으로 시장 데이터를 분석하여 Phase 2 초입 주도주를 발굴하고, 슬랙으로 리포트를 전달하는 Tool-use Agent 시스템. F1에서 구축한 stock_phases, sector_rs_daily, industry_rs_daily 데이터를 활용한다.

## User Goals

- 투자자로서, 매일 아침 시장 브레드스 현황과 Phase 2 초입 주도주 리스트를 슬랙으로 받아, 별도 분석 없이 바로 투자 후보를 파악하고 싶다.
- 매일 중복되는 종목이 아닌, 새롭게 부상하는 종목 위주로 퀄리티 높은 리포트를 받고 싶다.

## Behavior

### Happy Path

1. GitHub Actions에서 F1 ETL 파이프라인 완료
2. ETL validate 통과 후 Agent 스크립트 실행
3. Agent가 시스템 프롬프트와 도구 정의를 받고 시작
4. Agent가 `get_market_breadth`로 시장 전반 현황 파악
5. Agent가 `get_leading_sectors`로 주도 섹터/업종 확인
6. Agent가 `get_phase2_stocks`로 Phase 2 초입 종목 조회
7. Agent가 `read_report_history`로 최근 리포트 이력 확인
8. Agent가 중복 종목 필터링 + 신규/의미있는 변화가 있는 종목 선별
9. 필요시 `get_stock_detail`로 개별 종목 상세 정보 조회
10. Agent가 리포트 작성 (시장 개요 + 주도주 리스트)
11. `send_slack_report`로 슬랙 전달
12. `save_report_log`로 당일 리포트 이력 JSON 저장

### Error Cases

- **Claude API 오류 (429/500/timeout)**: 1회 재시도 후 실패 시 슬랙 에러 알림 + 로그 기록
- **DB 연결 실패**: 슬랙 에러 알림, 다음 날 재시도
- **토큰 한도 초과**: 도구 결과를 줄여서 재시도하거나 에러 알림
- **슬랙 Webhook 실패**: 로컬 파일에 리포트 저장 (fallback)

### Edge Cases

| Situation | Expected Behavior |
|-----------|-------------------|
| ETL 데이터가 없는 날 (공휴일) | Agent 실행 스킵, 슬랙으로 "오늘은 거래일이 아닙니다" 알림 |
| Phase 2 초입 종목이 0개 | "오늘은 신규 Phase 2 전환 종목이 없습니다" + 시장 개요만 전달 |
| 모든 종목이 이미 리포트된 종목 | Agent가 판단하여 "시장 업데이트" 형식으로 기존 주도주 현황 요약 |
| 이력 파일이 없는 첫 실행 | 이력 없이 전체 대상으로 분석, 새 이력 파일 생성 |
| 시장 급락/급등 | Agent가 브레드스 변화를 감지하고 리포트 톤/구성 자율 조정 |

## Interface Design

### Agent Tools

| Tool | 설명 | 주요 파라미터 |
|------|------|---------------|
| `get_market_breadth` | 전체 시장 브레드스 지표 | date |
| `get_leading_sectors` | 섹터/업종 RS 랭킹 + 트렌드 | date, limit |
| `get_phase2_stocks` | Phase 2 초입 종목 리스트 | date, min_rs, limit |
| `get_stock_detail` | 개별 종목 상세 (Phase, RS, MA, 52w 등) | symbol, date |
| `read_report_history` | 최근 N일 리포트 이력 조회 | days_back |
| `send_slack_report` | 슬랙 Webhook으로 리포트 전달 | message |
| `save_report_log` | 당일 리포트 이력 JSON 저장 | report_data |

### Slack Message Format

```
📊 시장 일일 리포트 (2026-03-04)

🌡️ 시장 개요
- Phase 2 비율: 29% (전일 대비 +1.2%)
- 주도 섹터: Energy (RS 70.6), Basic Materials (RS 64.1)
- 시장 온도: [Agent 판단 코멘트]

🔥 주도주 발굴
1. SYMBOL1 | Sector | RS 85 | Phase 1→2 전환
   - [Agent 분석 코멘트]
2. SYMBOL2 | Sector | RS 78 | Phase 2 초입
   - [Agent 분석 코멘트]
...

💡 Agent 인사이트
[Agent가 자율적으로 작성하는 시장 관찰/의견]
```

### Data Model

#### Report Log (JSON)

```typescript
interface DailyReportLog {
  date: string;                    // YYYY-MM-DD
  reportedSymbols: ReportedStock[];
  marketSummary: {
    phase2Ratio: number;
    leadingSectors: string[];
    totalAnalyzed: number;
  };
  metadata: {
    model: string;
    tokensUsed: { input: number; output: number };
    toolCalls: number;
    executionTime: number;         // ms
  };
}

interface ReportedStock {
  symbol: string;
  phase: number;
  prevPhase: number | null;
  rsScore: number;
  sector: string;
  industry: string;
  reason: string;                  // Agent가 작성한 선정 이유
  firstReportedDate: string;       // 최초 리포트 날짜
}
```

## Acceptance Criteria

- [ ] Agent가 DB 도구를 사용하여 시장 데이터를 자율적으로 조회할 수 있다
- [ ] Phase 2 초입 + RS 강세 종목을 발굴하여 리포트에 포함한다
- [ ] 이전 리포트 이력을 참고하여 중복 종목을 자율적으로 필터링한다
- [ ] 슬랙 Webhook으로 리포트가 정상 전달된다
- [ ] 일별 JSON 로그가 저장되어 다음 날 Agent가 참조할 수 있다
- [ ] ETL 완료 후 GitHub Actions에서 자동 실행된다
- [ ] Agent 실패 시 슬랙 에러 알림이 전달된다
- [ ] 거래일이 아닌 날에는 실행을 스킵한다

## Scope

**In Scope:**
- Agent 런타임 (Anthropic SDK + tool_use loop)
- 7개 전용 DB/IO 도구 구현
- 시스템 프롬프트 설계
- 슬랙 Webhook 전달
- JSON 파일 기반 이력 관리
- GitHub Actions 통합 (ETL 후 자동 실행)
- 에러 핸들링 + 슬랙 에러 알림

**Out of Scope:**
- 웹 대시보드 / UI
- 차트 / 이미지 생성
- 실시간 알림 (장중)
- 다중 사용자 / 구독 시스템
- 백테스팅 / 성과 추적
- Extended thinking (v1에서는 사용 안 함, 추후 검토)

## Open Questions

- [ ] 슬랙 메시지 길이 제한 (4,000자) 초과 시 분할 전송 vs 요약 전략
