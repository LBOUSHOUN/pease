ALTER TABLE "categories" DROP CONSTRAINT "categories_name_unique";--> statement-breakpoint
ALTER TABLE "stock_movements" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "categories_name_normalized_uq" ON "categories" USING btree (lower(trim("name")));--> statement-breakpoint
CREATE INDEX "categories_active_idx" ON "categories" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "products_category_idx" ON "products" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "products_active_type_idx" ON "products" USING btree ("is_active","product_type");--> statement-breakpoint
CREATE INDEX "products_sku_idx" ON "products" USING btree ("sku");--> statement-breakpoint
CREATE INDEX "products_manufacturer_barcode_idx" ON "products" USING btree ("manufacturer_barcode");--> statement-breakpoint
CREATE INDEX "products_internal_barcode_idx" ON "products" USING btree ("internal_barcode");--> statement-breakpoint
CREATE INDEX "products_qr_identifier_idx" ON "products" USING btree ("qr_identifier");--> statement-breakpoint
CREATE INDEX "stock_movements_product_date_idx" ON "stock_movements" USING btree ("product_id","created_at");--> statement-breakpoint
CREATE INDEX "stock_movements_worker_date_idx" ON "stock_movements" USING btree ("created_by","created_at");--> statement-breakpoint
CREATE INDEX "stock_movements_type_date_idx" ON "stock_movements" USING btree ("movement_type","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_movements_idempotency_uq" ON "stock_movements" USING btree ("idempotency_key") WHERE "stock_movements"."idempotency_key" is not null;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "product_other_values_ck" CHECK ("products"."wholesale_price_cents">=0 and "products"."wholesale_min_quantity">=0 and "products"."minimum_stock">=0);--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "product_type_ck" CHECK ("products"."product_type" in ('physical_product','service'));--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "service_stock_ck" CHECK ("products"."product_type"<>'service' or ("products"."track_stock"=false and "products"."current_stock"=0));