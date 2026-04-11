# Plan: Sentiment Confidence 역전 해소

## 문제 정의

Sentiment 에이전트의 confidence 레벨별 적중률이 역전됨:

| confidence | confirmed | invalidated | 적중률 |
|------------|-----------|-------------|--------|
| high       | 1         | 2           | 33.3%  |
| medium     | 7         | 6           | 53.8%  |
| low        | 2         | 2           | 50.0%  |

**근본 원인**: HIGH confidence를 추세 반전(mean-reversion) 예측에 부여하는 패턴.
추세 반전은 본질적으로 base rate가 낮은 이벤트인데, 확신 있는 예측 = HIGH로 매핑.

**INVALIDATED HIGH 2건:**
- "Energy 섹터 RS 75.71 기준, 60일 내 65선 하회로 조정 예상" → RS 78.82로 상승
- "VIX 현재 24.93 기준, 30일 내 20선 하회로 공포→중립 전환 완료" → VIX 27.29로 상승

## 골 정렬: ALIGNED

- 학습 루프에서 HIGH confidence thesis에 높은 가중치 → 노이즈 증폭
- Moderator 합의도 산출 시 confidence 참조 → 판단 왜곡
- Confidence 교정은 분석 시스템의 신뢰성 기반

## Before → After

**Before:**
- Sentiment agent가 mean-reversion 예측에 HIGH confidence 부여 가능
- structural_narrative 카테고리는 confidence 하향 면제 → HIGH가 그대로 DB 저장
- HIGH confidence 적중률 33.3%로 역전

**After:**
- 프롬프트에 mean-reversion 예측 → MEDIUM 이하 confidence 규칙 명시
- 코드 레벨 가드레일: sentiment + structural_narrative에서 mean-reversion 패턴 감지 시 HIGH → MEDIUM 캡
- sector_rotation은 기존 2단계 하향(→LOW) 유지 (변경 없음)
- structural_narrative의 추세 순응형(trend-following) 분석은 HIGH 유지

## 변경 사항

### 1. 프롬프트 가드레일 (sentiment-analyst.md)
- 규칙 추가: "추세 반전/mean-reversion 예측은 confidence MEDIUM 이하"
- 추세 방향 일치 예측만 HIGH 가능

### 2. 코드 레벨 가드레일 (round3-synthesis.ts)
- mean-reversion 패턴 감지 함수 추가 (`containsMeanReversionPattern`)
- sentiment + structural_narrative + HIGH + mean-reversion 패턴 → MEDIUM으로 캡
- 프롬프트 제약이 무시된 전적(#620, #645)을 감안한 방어적 가드레일

### 3. 테스트 (thesis-category-filter.test.ts)
- mean-reversion 패턴 감지 단위 테스트
- confidence 캡 통합 테스트 (structural_narrative + mean-reversion → MEDIUM)
- 비-mean-reversion structural_narrative는 HIGH 유지 확인

## 미구현 (보류)

- 학습 루프 confidence calibration 검증: HIGH 표본 3건으로 통계적 검증 불가. 표본 20건 이상 축적 후 재검토.
- Moderator confidence 가중치 로직 변경: 입력 품질 개선으로 자동 수혜, 별도 변경 불필요.

## 리스크

- **False positive**: mean-reversion 패턴 감지가 정당한 structural observation까지 캡할 수 있음
  → 패턴을 "전환 예측" 키워드 조합으로 한정하여 완화
- **표본 크기**: HIGH 3건으로 역전 검증이 통계적으로 불충분
  → 그러나 "추세 반전 = 낮은 confidence"는 확률론적으로 건전한 휴리스틱

## 무효 판정: VALID

이 이슈는 유효하다. confidence 역전은 시스템 신뢰도를 직접 훼손하며,
수정 방향(mean-reversion → MEDIUM 캡)은 표본 크기와 무관하게 건전하다.
