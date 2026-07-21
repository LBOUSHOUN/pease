ALTER TABLE "product_units" ADD COLUMN "return_item_id" integer;--> statement-breakpoint
ALTER TABLE "product_units" ADD COLUMN "return_condition" text;--> statement-breakpoint
ALTER TABLE "product_units" ADD CONSTRAINT "product_units_return_item_id_return_items_id_fk" FOREIGN KEY ("return_item_id") REFERENCES "public"."return_items"("id") ON DELETE no action ON UPDATE no action;