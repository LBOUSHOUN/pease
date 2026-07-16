ALTER TABLE "sales" DROP CONSTRAINT "sales_idempotency_key_unique";--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "next_sale_sequence" bigint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_credit_transactions" ADD COLUMN "balance_before_cents" bigint;--> statement-breakpoint
ALTER TABLE "customer_credit_transactions" ADD COLUMN "cash_register_session_id" integer;--> statement-breakpoint
ALTER TABLE "customer_credit_transactions" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "created_by" integer;--> statement-breakpoint
ALTER TABLE "cash_register_denominations" ADD COLUMN "phase" text DEFAULT 'closing' NOT NULL;--> statement-breakpoint
ALTER TABLE "cash_register_sessions" ADD COLUMN "opening_note" text;--> statement-breakpoint
ALTER TABLE "cash_register_sessions" ADD COLUMN "closing_note" text;--> statement-breakpoint
ALTER TABLE "cash_register_sessions" ADD COLUMN "opening_idempotency_key" text;--> statement-breakpoint
ALTER TABLE "cash_register_sessions" ADD COLUMN "closing_idempotency_key" text;--> statement-breakpoint
ALTER TABLE "customer_credit_transactions" ADD CONSTRAINT "customer_credit_transactions_cash_register_session_id_cash_register_sessions_id_fk" FOREIGN KEY ("cash_register_session_id") REFERENCES "public"."cash_register_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cash_movements_register_date_idx" ON "cash_movements" USING btree ("cash_register_session_id","created_at");--> statement-breakpoint
CREATE INDEX "cash_movements_reference_idx" ON "cash_movements" USING btree ("reference_type","reference_id");--> statement-breakpoint
CREATE INDEX "customer_credit_customer_date_idx" ON "customer_credit_transactions" USING btree ("customer_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_credit_worker_idempotency_uq" ON "customer_credit_transactions" USING btree ("created_by","idempotency_key") WHERE "customer_credit_transactions"."idempotency_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "register_open_idempotency_uq" ON "cash_register_sessions" USING btree ("cashier_id","opening_idempotency_key") WHERE "cash_register_sessions"."opening_idempotency_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "register_close_idempotency_uq" ON "cash_register_sessions" USING btree ("cashier_id","closing_idempotency_key") WHERE "cash_register_sessions"."closing_idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "register_cashier_date_idx" ON "cash_register_sessions" USING btree ("cashier_id","opened_at");--> statement-breakpoint
CREATE INDEX "sale_items_sale_idx" ON "sale_items" USING btree ("sale_id");--> statement-breakpoint
CREATE INDEX "sale_items_product_idx" ON "sale_items" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_cashier_idempotency_uq" ON "sales" USING btree ("cashier_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "sales_date_idx" ON "sales" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "sales_customer_date_idx" ON "sales" USING btree ("customer_id","created_at");--> statement-breakpoint
CREATE INDEX "sales_cashier_date_idx" ON "sales" USING btree ("cashier_id","created_at");