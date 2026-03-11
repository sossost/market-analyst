# Report Quality Fix #157 — Phase 2 비율 재발 방어 + 일간 리포트 섹션 강제화

## 문제

이슈 #150에서 Phase 2 비율 이중 변환(3520%) 버그를 수정했으나, 재발 가능성이 잔존한다.
LLM이 도구 출력(이미 퍼센트 단위)을 리포트에 기재할 때 다시 x100하는 패턴이 관찰됨.
또한 일간 리포트의 MD 파일 구조가 산문형이어서 필수 섹션이 누락되는 경우가 있다.

## 변경 사항 (7단계)

### 1-A. 시스템 프롬프트에 도구 출력 단위 명시
- `buildDailySystemPrompt`, `buildWeeklySystemPrompt`의 규칙 섹션에 phase2Ratio 단위 주의사항 삽입
- "phase2Ratio는 이미 퍼센트 단위(0~100). 절대 x100 하지 마라."

### 1-B. reportValidator에 phase2Ratio 범위 검증 추가
- `checkPhase2RatioRange` 함수: `Phase 2: XXXX%` 패턴에서 100 초과 시 error
- `validateReport`에서 호출

### 2-A. 일간 MD 파일 지시 구조화
- 산문형 목록을 번호부여 필수 섹션으로 교체

### 2-B. reportValidator에 일간 필수 섹션 검증 추가
- `checkDailySections` 함수: "시장 온도", "섹터", "시장 흐름" 키워드 검증
- `validateReport`에서 호출 (reportType: "daily" 시)

### 3-A. reportValidator 테스트 확장
- Phase 2 비율 범위 검증 케이스 + 일간 섹션 검증 케이스

### 3-B. phase2RatioConversion 테스트 확장
- 3050% 패턴 감지 회귀 테스트

### 7. 전체 테스트 통과 확인
