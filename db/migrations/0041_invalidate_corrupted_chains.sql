-- Fix #793: Invalidate corrupted narrative chains created from legacy thesis fallback.
-- Chain ID 6 (에너지/호르무즈) has megatrend === bottleneck (thesis first sentence copy)
-- with empty demand_driver and supply_chain — a known backfill artifact.
--
-- This migration also scans for any other chains with the same corruption pattern.

-- Invalidate chain ID 6 specifically
UPDATE "narrative_chains"
SET "status" = 'INVALIDATED'
WHERE "id" = 6
  AND "status" != 'INVALIDATED';

-- Full scan: invalidate any other corrupted chains where megatrend = bottleneck
-- and structural fields are empty (legacy fallback artifact)
UPDATE "narrative_chains"
SET "status" = 'INVALIDATED'
WHERE "megatrend" = "bottleneck"
  AND ("demand_driver" = '' OR "supply_chain" = '')
  AND "status" NOT IN ('INVALIDATED', 'RESOLVED');
