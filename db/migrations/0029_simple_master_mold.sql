ALTER TABLE "market_breadth_daily" DROP CONSTRAINT "market_breadth_daily_pkey";--> statement-breakpoint
ALTER TABLE "market_breadth_daily" ALTER COLUMN "date" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "market_breadth_daily" ADD CONSTRAINT "market_breadth_daily_date_pk" PRIMARY KEY("date");
