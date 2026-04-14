-- #773: tracked_stocks 통합 테이블
-- recommendations(etl_auto) + watchlist_stocks(agent) + thesis 수혜주(thesis_aligned)를 단일 테이블로 통합.
-- 90일 고정 윈도우로 Phase 궤적과 듀레이션 수익률을 추적한다.

CREATE TABLE IF NOT EXISTS tracked_stocks (
  id SERIAL PRIMARY KEY,
  symbol TEXT NOT NULL,

  -- 진입 경로
  source TEXT NOT NULL,                    -- 'etl_auto' | 'agent' | 'thesis_aligned'
  tier TEXT NOT NULL DEFAULT 'standard',   -- 'standard' | 'featured'

  -- 진입 시점 스냅샷
  entry_date TEXT NOT NULL,                -- YYYY-MM-DD
  entry_price NUMERIC NOT NULL,
  entry_phase SMALLINT NOT NULL,
  entry_prev_phase SMALLINT,
  entry_rs_score INTEGER,
  entry_sepa_grade TEXT,                   -- 'S' | 'A' | 'B' | 'C' | 'F'
  entry_thesis_id INTEGER,                 -- thesis 연결 (nullable)
  entry_sector TEXT,
  entry_industry TEXT,
  entry_reason TEXT,

  -- 상태
  status TEXT NOT NULL DEFAULT 'ACTIVE',   -- 'ACTIVE' | 'EXPIRED' | 'EXITED'
  market_regime TEXT,

  -- 현재 상태 (매일 ETL 갱신)
  current_price NUMERIC,
  current_phase SMALLINT,
  current_rs_score INTEGER,
  pnl_percent NUMERIC,
  max_pnl_percent NUMERIC,
  days_tracked INTEGER DEFAULT 0,
  last_updated TEXT,

  -- 듀레이션 수익률 스냅샷 (해당 시점 경과 후 계산, immutable)
  return_7d NUMERIC,
  return_30d NUMERIC,
  return_90d NUMERIC,

  -- 90일 윈도우
  tracking_end_date TEXT,                  -- entry_date + 90일
  phase_trajectory JSONB,                  -- [{date, phase, rsScore}]
  sector_relative_perf NUMERIC,

  -- 종료 정보
  exit_date TEXT,
  exit_reason TEXT,

  -- 타임스탬프
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_tracked_stocks_symbol_date UNIQUE (symbol, entry_date)
);

CREATE INDEX IF NOT EXISTS idx_tracked_stocks_status ON tracked_stocks (status);
CREATE INDEX IF NOT EXISTS idx_tracked_stocks_source ON tracked_stocks (source);
CREATE INDEX IF NOT EXISTS idx_tracked_stocks_entry_date ON tracked_stocks (entry_date);
CREATE INDEX IF NOT EXISTS idx_tracked_stocks_symbol ON tracked_stocks (symbol);
CREATE INDEX IF NOT EXISTS idx_tracked_stocks_tier ON tracked_stocks (tier);
