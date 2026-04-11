-- #735: meta_regimes 테이블 + narrative_chains 컬럼 추가
-- meta_regimes: 국면(테마 사이클) 계층 — narrative_chains의 상위 구조
-- narrative_chains: N+1 수혜 섹터/종목, 국면 연결, 라이프사이클 타임스탬프

-- 1. meta_regimes 테이블 생성
CREATE TABLE IF NOT EXISTS meta_regimes (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  propagation_type TEXT NOT NULL, -- 'supply_chain' | 'narrative_shift'
  status TEXT NOT NULL DEFAULT 'ACTIVE', -- 'ACTIVE' | 'PEAKED' | 'RESOLVED'
  activated_at TIMESTAMPTZ,
  peak_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_meta_regimes_status ON meta_regimes (status);

-- 2. narrative_chains 컬럼 추가
ALTER TABLE narrative_chains
  ADD COLUMN IF NOT EXISTS next_beneficiary_sectors JSONB,
  ADD COLUMN IF NOT EXISTS next_beneficiary_tickers JSONB,
  ADD COLUMN IF NOT EXISTS meta_regime_id INTEGER REFERENCES meta_regimes(id),
  ADD COLUMN IF NOT EXISTS sequence_order INTEGER,
  ADD COLUMN IF NOT EXISTS sequence_confidence TEXT,
  ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS peak_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_narrative_chains_meta_regime_id
  ON narrative_chains (meta_regime_id);
