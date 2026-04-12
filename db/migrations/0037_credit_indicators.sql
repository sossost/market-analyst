-- #748: FRED 신용 스프레드/금융 스트레스 지표 수집
-- HY OAS, CCC Spread, BBB Spread, Financial Stress Index를 일간 수집하고
-- 90일 rolling z-score를 계산하여 토론 컨텍스트에 주입한다.

CREATE TABLE IF NOT EXISTS credit_indicators (
  date        TEXT        NOT NULL,
  series_id   TEXT        NOT NULL,
  value       NUMERIC     NOT NULL,
  z_score_90d NUMERIC,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (date, series_id)
);

CREATE INDEX IF NOT EXISTS idx_credit_indicators_series_date
  ON credit_indicators (series_id, date DESC);

ALTER TABLE credit_indicators
  ADD CONSTRAINT chk_credit_indicators_date_format
  CHECK (date ~ '^\d{4}-\d{2}-\d{2}$');
