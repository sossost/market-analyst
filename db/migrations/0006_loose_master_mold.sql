CREATE TABLE "signal_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"symbol" text NOT NULL,
	"entry_date" text NOT NULL,
	"entry_price" numeric NOT NULL,
	"rs_score" integer,
	"volume_confirmed" boolean,
	"sector_group_phase" smallint,
	"sector" text,
	"industry" text,
	"params_snapshot" text,
	"return_5d" numeric,
	"return_10d" numeric,
	"return_20d" numeric,
	"return_60d" numeric,
	"phase_exit_date" text,
	"phase_exit_return" numeric,
	"max_return" numeric,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"days_held" integer DEFAULT 0,
	"last_updated" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_signal_log_symbol_date" UNIQUE("symbol","entry_date")
);
--> statement-breakpoint
CREATE TABLE "signal_params" (
	"id" serial PRIMARY KEY NOT NULL,
	"param_name" text NOT NULL,
	"current_value" text NOT NULL,
	"previous_value" text,
	"change_reason" text,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"performance_before" numeric,
	"performance_after" numeric
);
--> statement-breakpoint
CREATE INDEX "idx_signal_log_status" ON "signal_log" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_signal_log_entry_date" ON "signal_log" USING btree ("entry_date");--> statement-breakpoint
CREATE INDEX "idx_signal_params_name" ON "signal_params" USING btree ("param_name");