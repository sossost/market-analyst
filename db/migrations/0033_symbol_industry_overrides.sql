-- symbol_industry_overrides: FMP 업종 오분류 보정 테이블
-- symbols 테이블의 FMP 원본은 보존하고, 조회 시 COALESCE로 override 우선 적용

CREATE TABLE IF NOT EXISTS symbol_industry_overrides (
  symbol TEXT PRIMARY KEY REFERENCES symbols(symbol) ON DELETE CASCADE,
  industry TEXT NOT NULL,
  original_industry TEXT,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 초기 데이터: SNDK (NAND 플래시) — FMP가 Hardware로 오분류
INSERT INTO symbol_industry_overrides (symbol, industry, original_industry, reason)
VALUES ('SNDK', 'Semiconductors', 'Hardware, Equipment & Parts', 'NAND flash memory manufacturer misclassified by FMP')
ON CONFLICT (symbol) DO NOTHING;
