CREATE TABLE "news_archive" (
	"id" serial PRIMARY KEY NOT NULL,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"source" text,
	"published_at" text,
	"collected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"category" text NOT NULL,
	"sentiment" text NOT NULL,
	"query_persona" text,
	"query_text" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_news_archive_url" UNIQUE("url")
);
--> statement-breakpoint
CREATE INDEX "idx_news_archive_collected_at" ON "news_archive" USING btree ("collected_at");--> statement-breakpoint
CREATE INDEX "idx_news_archive_category" ON "news_archive" USING btree ("category");--> statement-breakpoint
CREATE INDEX "idx_news_archive_sentiment" ON "news_archive" USING btree ("sentiment");--> statement-breakpoint
CREATE INDEX "idx_news_archive_persona" ON "news_archive" USING btree ("query_persona");