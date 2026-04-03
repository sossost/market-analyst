ALTER TABLE "market_breadth_daily" ADD COLUMN IF NOT EXISTS "breadth_score" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "market_breadth_daily" ADD COLUMN IF NOT EXISTS "divergence_signal" varchar(20);--> statement-breakpoint
ALTER TABLE "stock_phases" ADD COLUMN "weekly_vol_ratio" numeric;--> statement-breakpoint
ALTER TABLE "stock_phases" ADD COLUMN "breakout_signal" text;