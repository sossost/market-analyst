-- #751: 뉴스 테마 추출 테이블
-- LLM 기반 뉴스 테마 분석 결과를 저장한다.
-- (date, theme) 유니크 제약으로 동일 날짜 동일 테마 중복 방지.

CREATE TABLE IF NOT EXISTS news_themes (
  id SERIAL PRIMARY KEY,
  date TEXT NOT NULL,
  theme TEXT NOT NULL,
  impacted_industries JSONB NOT NULL,
  impact_mechanism TEXT NOT NULL,
  severity TEXT NOT NULL,
  source_count INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_news_themes_date_theme UNIQUE (date, theme)
);

CREATE INDEX IF NOT EXISTS idx_news_themes_date ON news_themes (date);
CREATE INDEX IF NOT EXISTS idx_news_themes_severity ON news_themes (severity);
