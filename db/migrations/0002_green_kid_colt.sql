CREATE TABLE "access_codes" (
	"code" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asset_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text DEFAULT '0' NOT NULL,
	"date" timestamp NOT NULL,
	"total_assets" numeric NOT NULL,
	"cash" numeric NOT NULL,
	"position_value" numeric NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_asset_snapshots_user_date" UNIQUE("user_id","date")
);
--> statement-breakpoint
CREATE TABLE "daily_breakout_signals" (
	"symbol" text NOT NULL,
	"date" text NOT NULL,
	"is_confirmed_breakout" boolean DEFAULT false NOT NULL,
	"breakout_percent" numeric,
	"volume_ratio" numeric,
	"is_perfect_retest" boolean DEFAULT false NOT NULL,
	"ma20_distance_percent" numeric,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_daily_breakout_signals_symbol_date" UNIQUE("symbol","date")
);
--> statement-breakpoint
CREATE TABLE "daily_ma" (
	"symbol" text NOT NULL,
	"date" text NOT NULL,
	"ma20" numeric,
	"ma50" numeric,
	"ma100" numeric,
	"ma200" numeric,
	"vol_ma30" numeric,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_daily_ma_symbol_date" UNIQUE("symbol","date")
);
--> statement-breakpoint
CREATE TABLE "daily_noise_signals" (
	"symbol" text NOT NULL,
	"date" text NOT NULL,
	"avg_dollar_volume_20d" numeric,
	"avg_volume_20d" numeric,
	"atr14" numeric,
	"atr14_percent" numeric,
	"bb_width_current" numeric,
	"bb_width_avg_60d" numeric,
	"is_vcp" boolean DEFAULT false NOT NULL,
	"body_ratio" numeric,
	"ma20_ma50_distance_percent" numeric,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_daily_noise_signals_symbol_date" UNIQUE("symbol","date")
);
--> statement-breakpoint
CREATE TABLE "daily_prices" (
	"symbol" text NOT NULL,
	"date" text NOT NULL,
	"open" numeric,
	"high" numeric,
	"low" numeric,
	"close" numeric,
	"adj_close" numeric,
	"volume" numeric,
	"rs_score" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_daily_prices_symbol_date" UNIQUE("symbol","date")
);
--> statement-breakpoint
CREATE TABLE "daily_ratios" (
	"symbol" text NOT NULL,
	"date" text NOT NULL,
	"pe_ratio" numeric,
	"ps_ratio" numeric,
	"pb_ratio" numeric,
	"peg_ratio" numeric,
	"ev_ebitda" numeric,
	"market_cap" numeric,
	"eps_ttm" numeric,
	"revenue_ttm" numeric,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_daily_ratios_symbol_date" UNIQUE("symbol","date")
);
--> statement-breakpoint
CREATE TABLE "device_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text DEFAULT '0' NOT NULL,
	"device_id" text NOT NULL,
	"push_token" text NOT NULL,
	"platform" text NOT NULL,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "uq_device_tokens_device_id" UNIQUE("device_id")
);
--> statement-breakpoint
CREATE TABLE "portfolio_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text DEFAULT '0' NOT NULL,
	"cash_balance" numeric DEFAULT '0' NOT NULL,
	"initial_cash_balance" numeric DEFAULT '0',
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portfolio_settings_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "price_alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"symbol" text NOT NULL,
	"alert_type" text NOT NULL,
	"alert_date" text NOT NULL,
	"condition_data" jsonb,
	"notified_at" timestamp with time zone DEFAULT now(),
	"notification_channels" text[],
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "uq_price_alerts_symbol_type_date" UNIQUE("symbol","alert_type","alert_date")
);
--> statement-breakpoint
CREATE TABLE "quarterly_financials" (
	"symbol" text NOT NULL,
	"period_end_date" text NOT NULL,
	"as_of_q" text NOT NULL,
	"revenue" numeric,
	"net_income" numeric,
	"operating_income" numeric,
	"ebitda" numeric,
	"gross_profit" numeric,
	"operating_cash_flow" numeric,
	"free_cash_flow" numeric,
	"eps_diluted" numeric,
	"eps_basic" numeric,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_quarterly_financials_symbol_period" UNIQUE("symbol","period_end_date")
);
--> statement-breakpoint
CREATE TABLE "quarterly_ratios" (
	"symbol" text NOT NULL,
	"period_end_date" text NOT NULL,
	"as_of_q" text NOT NULL,
	"pe_ratio" numeric,
	"peg_ratio" numeric,
	"fwd_peg_ratio" numeric,
	"ps_ratio" numeric,
	"pb_ratio" numeric,
	"ev_ebitda" numeric,
	"gross_margin" numeric,
	"op_margin" numeric,
	"net_margin" numeric,
	"debt_equity" numeric,
	"debt_assets" numeric,
	"debt_mkt_cap" numeric,
	"int_coverage" numeric,
	"p_ocf_ratio" numeric,
	"p_fcf_ratio" numeric,
	"ocf_ratio" numeric,
	"fcf_per_share" numeric,
	"div_yield" numeric,
	"payout_ratio" numeric,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_quarterly_ratios_symbol_period" UNIQUE("symbol","period_end_date")
);
--> statement-breakpoint
CREATE TABLE "symbols" (
	"symbol" text PRIMARY KEY NOT NULL,
	"company_name" text,
	"market_cap" numeric,
	"sector" text,
	"industry" text,
	"beta" numeric,
	"price" numeric,
	"last_annual_dividend" numeric,
	"volume" numeric,
	"exchange" text,
	"exchange_short_name" text,
	"country" text,
	"is_etf" boolean DEFAULT false,
	"is_fund" boolean DEFAULT false,
	"is_actively_trading" boolean DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "trade_actions" (
	"id" serial PRIMARY KEY NOT NULL,
	"trade_id" integer NOT NULL,
	"action_type" text NOT NULL,
	"action_date" timestamp with time zone DEFAULT now() NOT NULL,
	"price" numeric NOT NULL,
	"quantity" integer NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trades" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text DEFAULT '0' NOT NULL,
	"symbol" text NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"strategy" text,
	"plan_entry_price" numeric,
	"plan_stop_loss" numeric,
	"plan_target_price" numeric,
	"plan_targets" jsonb,
	"entry_reason" text,
	"commission_rate" numeric DEFAULT '0.07',
	"final_pnl" numeric,
	"final_roi" numeric,
	"final_r_multiple" numeric,
	"mistake_type" text,
	"review_note" text,
	"start_date" timestamp with time zone,
	"end_date" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "watchlist" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"symbol" text NOT NULL,
	"added_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "uq_watchlist_user_symbol" UNIQUE("user_id","symbol")
);
--> statement-breakpoint
ALTER TABLE "daily_breakout_signals" ADD CONSTRAINT "daily_breakout_signals_symbol_symbols_symbol_fk" FOREIGN KEY ("symbol") REFERENCES "public"."symbols"("symbol") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_ma" ADD CONSTRAINT "daily_ma_symbol_symbols_symbol_fk" FOREIGN KEY ("symbol") REFERENCES "public"."symbols"("symbol") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_noise_signals" ADD CONSTRAINT "daily_noise_signals_symbol_symbols_symbol_fk" FOREIGN KEY ("symbol") REFERENCES "public"."symbols"("symbol") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_prices" ADD CONSTRAINT "daily_prices_symbol_symbols_symbol_fk" FOREIGN KEY ("symbol") REFERENCES "public"."symbols"("symbol") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_ratios" ADD CONSTRAINT "daily_ratios_symbol_symbols_symbol_fk" FOREIGN KEY ("symbol") REFERENCES "public"."symbols"("symbol") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_alerts" ADD CONSTRAINT "price_alerts_symbol_symbols_symbol_fk" FOREIGN KEY ("symbol") REFERENCES "public"."symbols"("symbol") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quarterly_financials" ADD CONSTRAINT "quarterly_financials_symbol_symbols_symbol_fk" FOREIGN KEY ("symbol") REFERENCES "public"."symbols"("symbol") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quarterly_ratios" ADD CONSTRAINT "quarterly_ratios_symbol_symbols_symbol_fk" FOREIGN KEY ("symbol") REFERENCES "public"."symbols"("symbol") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_actions" ADD CONSTRAINT "trade_actions_trade_id_trades_id_fk" FOREIGN KEY ("trade_id") REFERENCES "public"."trades"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_symbol_symbols_symbol_fk" FOREIGN KEY ("symbol") REFERENCES "public"."symbols"("symbol") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchlist" ADD CONSTRAINT "watchlist_symbol_symbols_symbol_fk" FOREIGN KEY ("symbol") REFERENCES "public"."symbols"("symbol") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_asset_snapshots_user_date" ON "asset_snapshots" USING btree ("user_id","date");--> statement-breakpoint
CREATE INDEX "idx_daily_breakout_signals_date_confirmed" ON "daily_breakout_signals" USING btree ("date","is_confirmed_breakout");--> statement-breakpoint
CREATE INDEX "idx_daily_breakout_signals_date_retest" ON "daily_breakout_signals" USING btree ("date","is_perfect_retest");--> statement-breakpoint
CREATE INDEX "idx_daily_ma_symbol_date" ON "daily_ma" USING btree ("symbol","date");--> statement-breakpoint
CREATE INDEX "idx_daily_noise_signals_date_vcp" ON "daily_noise_signals" USING btree ("date","is_vcp");--> statement-breakpoint
CREATE INDEX "idx_daily_prices_symbol_date" ON "daily_prices" USING btree ("symbol","date");--> statement-breakpoint
CREATE INDEX "idx_daily_ratios_symbol_date" ON "daily_ratios" USING btree ("symbol","date");--> statement-breakpoint
CREATE INDEX "idx_device_tokens_user_id" ON "device_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_device_tokens_active" ON "device_tokens" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "idx_price_alerts_symbol_date" ON "price_alerts" USING btree ("symbol","alert_date");--> statement-breakpoint
CREATE INDEX "idx_price_alerts_type_date" ON "price_alerts" USING btree ("alert_type","alert_date");--> statement-breakpoint
CREATE INDEX "idx_quarterly_financials_symbol_q" ON "quarterly_financials" USING btree ("symbol","as_of_q");--> statement-breakpoint
CREATE INDEX "idx_trade_actions_trade_id" ON "trade_actions" USING btree ("trade_id");--> statement-breakpoint
CREATE INDEX "idx_trade_actions_date" ON "trade_actions" USING btree ("action_date");--> statement-breakpoint
CREATE INDEX "idx_trades_user_status" ON "trades" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "idx_trades_user_symbol" ON "trades" USING btree ("user_id","symbol");--> statement-breakpoint
CREATE INDEX "idx_trades_start_date" ON "trades" USING btree ("start_date");--> statement-breakpoint
CREATE INDEX "idx_watchlist_user" ON "watchlist" USING btree ("user_id");