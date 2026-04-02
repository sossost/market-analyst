ALTER TABLE "market_breadth_daily" ADD COLUMN "vix_close" numeric(6, 2);--> statement-breakpoint
ALTER TABLE "market_breadth_daily" ADD COLUMN "fear_greed_score" integer;--> statement-breakpoint
ALTER TABLE "market_breadth_daily" ADD COLUMN "fear_greed_rating" varchar(30);