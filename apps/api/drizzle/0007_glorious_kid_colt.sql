CREATE TABLE "product_units" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" integer NOT NULL,
	"barcode" text NOT NULL,
	"status" text DEFAULT 'available' NOT NULL,
	"receiving_session_id" integer,
	"purchase_id" integer,
	"purchase_item_id" integer,
	"sale_id" integer,
	"sale_item_id" integer,
	"return_id" integer,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sold_at" timestamp with time zone,
	"returned_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_units_barcode_ck" CHECK (length(trim("product_units"."barcode")) between 2 and 100),
	CONSTRAINT "product_units_status_ck" CHECK ("product_units"."status" in ('available','sold','damaged','lost','inactive'))
);
--> statement-breakpoint
CREATE TABLE "serialized_receiving_scans" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" integer NOT NULL,
	"barcode" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "serialized_receiving_scan_barcode_ck" CHECK (length(trim("serialized_receiving_scans"."barcode")) between 2 and 100)
);
--> statement-breakpoint
CREATE TABLE "serialized_receiving_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" integer NOT NULL,
	"supplier_id" integer,
	"purchase_id" integer,
	"expected_quantity" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by" integer NOT NULL,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "serialized_receiving_quantity_ck" CHECK ("serialized_receiving_sessions"."expected_quantity">0 and "serialized_receiving_sessions"."expected_quantity"<=1000),
	CONSTRAINT "serialized_receiving_status_ck" CHECK ("serialized_receiving_sessions"."status" in ('draft','completed','cancelled'))
);
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "inventory_mode" text DEFAULT 'quantity' NOT NULL;--> statement-breakpoint
ALTER TABLE "product_units" ADD CONSTRAINT "product_units_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_units" ADD CONSTRAINT "product_units_receiving_session_id_serialized_receiving_sessions_id_fk" FOREIGN KEY ("receiving_session_id") REFERENCES "public"."serialized_receiving_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_units" ADD CONSTRAINT "product_units_purchase_id_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_units" ADD CONSTRAINT "product_units_purchase_item_id_purchase_items_id_fk" FOREIGN KEY ("purchase_item_id") REFERENCES "public"."purchase_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_units" ADD CONSTRAINT "product_units_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_units" ADD CONSTRAINT "product_units_sale_item_id_sale_items_id_fk" FOREIGN KEY ("sale_item_id") REFERENCES "public"."sale_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_units" ADD CONSTRAINT "product_units_return_id_returns_id_fk" FOREIGN KEY ("return_id") REFERENCES "public"."returns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "serialized_receiving_scans" ADD CONSTRAINT "serialized_receiving_scans_session_id_serialized_receiving_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."serialized_receiving_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "serialized_receiving_sessions" ADD CONSTRAINT "serialized_receiving_sessions_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "serialized_receiving_sessions" ADD CONSTRAINT "serialized_receiving_sessions_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "serialized_receiving_sessions" ADD CONSTRAINT "serialized_receiving_sessions_purchase_id_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "serialized_receiving_sessions" ADD CONSTRAINT "serialized_receiving_sessions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "product_units_barcode_normalized_uq" ON "product_units" USING btree (lower(trim("barcode")));--> statement-breakpoint
CREATE INDEX "product_units_barcode_idx" ON "product_units" USING btree ("barcode");--> statement-breakpoint
CREATE INDEX "product_units_product_status_idx" ON "product_units" USING btree ("product_id","status");--> statement-breakpoint
CREATE INDEX "product_units_sale_idx" ON "product_units" USING btree ("sale_id","sale_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "serialized_receiving_scan_session_barcode_uq" ON "serialized_receiving_scans" USING btree ("session_id",lower(trim("barcode")));--> statement-breakpoint
CREATE INDEX "serialized_receiving_scan_session_idx" ON "serialized_receiving_scans" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE INDEX "serialized_receiving_product_status_idx" ON "serialized_receiving_sessions" USING btree ("product_id","status");--> statement-breakpoint
CREATE INDEX "serialized_receiving_creator_date_idx" ON "serialized_receiving_sessions" USING btree ("created_by","created_at");--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "product_inventory_mode_ck" CHECK ("products"."inventory_mode" in ('quantity','serialized'));--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "service_inventory_mode_ck" CHECK ("products"."product_type"<>'service' or "products"."inventory_mode"='quantity');
--> statement-breakpoint
CREATE OR REPLACE FUNCTION reconcile_serialized_product_stock() RETURNS trigger AS $$
DECLARE target_product integer;
BEGIN
  target_product := COALESCE(NEW.product_id, OLD.product_id);
  UPDATE products
     SET current_stock=(SELECT count(*)::integer FROM product_units WHERE product_id=target_product AND status='available'),
         updated_at=now()
   WHERE id=target_product AND inventory_mode='serialized';
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER product_units_reconcile_stock
AFTER INSERT OR UPDATE OF status,product_id OR DELETE ON product_units
FOR EACH ROW EXECUTE FUNCTION reconcile_serialized_product_stock();
