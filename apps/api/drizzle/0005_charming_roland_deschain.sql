ALTER TABLE "expenses" ALTER COLUMN "cash_register_session_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "supplier_payments" ALTER COLUMN "cash_register_session_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "next_purchase_sequence" bigint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "next_return_sequence" bigint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "payment_source" text DEFAULT 'cash_register' NOT NULL;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "correction_reason" text;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "payment_mode" text DEFAULT 'credit' NOT NULL;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "payment_source" text DEFAULT 'external_cash' NOT NULL;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "invoice_number" text;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "invoice_date" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "returns" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "returns" ADD COLUMN "status" text DEFAULT 'completed' NOT NULL;--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD COLUMN "transaction_type" text DEFAULT 'supplier_payment' NOT NULL;--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD COLUMN "payment_source" text;--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD COLUMN "balance_before_cents" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD COLUMN "balance_after_cents" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "created_by" integer;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "expenses_worker_idempotency_uq" ON "expenses" USING btree ("created_by","idempotency_key") WHERE "expenses"."idempotency_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "expenses_correction_uq" ON "expenses" USING btree ("correction_of_id") WHERE "expenses"."correction_of_id" is not null;--> statement-breakpoint
CREATE INDEX "expenses_date_idx" ON "expenses" USING btree ("expense_date");--> statement-breakpoint
CREATE INDEX "expenses_category_date_idx" ON "expenses" USING btree ("category","expense_date");--> statement-breakpoint
CREATE INDEX "purchase_items_purchase_idx" ON "purchase_items" USING btree ("purchase_id");--> statement-breakpoint
CREATE INDEX "purchase_items_product_idx" ON "purchase_items" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "purchases_worker_idempotency_uq" ON "purchases" USING btree ("created_by","idempotency_key") WHERE "purchases"."idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "purchases_supplier_date_idx" ON "purchases" USING btree ("supplier_id","created_at");--> statement-breakpoint
CREATE INDEX "purchases_date_idx" ON "purchases" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "return_items_return_idx" ON "return_items" USING btree ("return_id");--> statement-breakpoint
CREATE INDEX "return_items_sale_item_idx" ON "return_items" USING btree ("sale_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "returns_worker_idempotency_uq" ON "returns" USING btree ("created_by","idempotency_key") WHERE "returns"."idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "returns_sale_date_idx" ON "returns" USING btree ("original_sale_id","created_at");--> statement-breakpoint
CREATE INDEX "returns_date_idx" ON "returns" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "supplier_ledger_supplier_date_idx" ON "supplier_payments" USING btree ("supplier_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_ledger_worker_idempotency_uq" ON "supplier_payments" USING btree ("created_by","idempotency_key") WHERE "supplier_payments"."idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "suppliers_name_idx" ON "suppliers" USING btree ("name");--> statement-breakpoint
CREATE INDEX "suppliers_active_debt_idx" ON "suppliers" USING btree ("is_active","current_debt_cents");--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_amount_ck" CHECK ("expenses"."amount_cents"<>0);--> statement-breakpoint
ALTER TABLE "purchase_items" ADD CONSTRAINT "purchase_items_values_ck" CHECK ("purchase_items"."quantity">0 and "purchase_items"."unit_purchase_price_cents">=0 and "purchase_items"."line_total_cents">=0);--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_money_ck" CHECK ("purchases"."subtotal_cents">=0 and "purchases"."total_cents">=0 and "purchases"."paid_cents">=0 and "purchases"."remaining_cents">=0 and "purchases"."paid_cents"+"purchases"."remaining_cents"="purchases"."total_cents");--> statement-breakpoint
ALTER TABLE "return_items" ADD CONSTRAINT "return_items_values_ck" CHECK ("return_items"."quantity">0 and "return_items"."amount_cents">=0);--> statement-breakpoint
ALTER TABLE "returns" ADD CONSTRAINT "returns_money_ck" CHECK ("returns"."total_return_value_cents">0 and "returns"."customer_debt_reduction_cents">=0 and "returns"."cash_refund_cents">=0 and "returns"."customer_debt_reduction_cents"+"returns"."cash_refund_cents"="returns"."total_return_value_cents");--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_ledger_balance_ck" CHECK ("supplier_payments"."balance_before_cents">=0 and "supplier_payments"."balance_after_cents">=0);--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_debt_ck" CHECK ("suppliers"."current_debt_cents">=0);