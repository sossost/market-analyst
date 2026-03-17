ALTER TABLE "stock_analysis_reports" ADD COLUMN "price_target" numeric;--> statement-breakpoint
ALTER TABLE "stock_analysis_reports" ADD COLUMN "price_target_upside" numeric;--> statement-breakpoint
ALTER TABLE "stock_analysis_reports" ADD COLUMN "price_target_data" text;--> statement-breakpoint
ALTER TABLE "stock_analysis_reports" ADD COLUMN "price_target_analysis" text;