-- #750: 뉴스 사각지대 분석 테이블
-- Gap Analyzer(Haiku)가 식별한 사각지대 테마와 동적 검색 쿼리를 저장한다.
-- (date, theme) 유니크 제약으로 동일 날짜 동일 테마 중복 방지.

CREATE TABLE IF NOT EXISTS news_gap_analysis (
  id SERIAL PRIMARY KEY,
  date TEXT NOT NULL,
  theme TEXT NOT NULL,
  query TEXT NOT NULL,
  rationale TEXT NOT NULL,
  articles_found INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_news_gap_analysis_date_theme UNIQUE (date, theme)
);

CREATE INDEX IF NOT EXISTS idx_news_gap_analysis_date ON news_gap_analysis (date);
