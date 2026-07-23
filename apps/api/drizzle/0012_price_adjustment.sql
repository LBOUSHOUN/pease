ALTER TABLE "sale_items" ADD COLUMN "base_unit_price_cents" bigint;--> statement-breakpoint
ALTER TABLE "sale_items" ADD COLUMN "price_adjustment_type" text;--> statement-breakpoint
ALTER TABLE "sale_items" ADD COLUMN "price_adjustment_value" integer;--> statement-breakpoint
ALTER TABLE "sale_items" ADD COLUMN "price_adjustment_reason" text;--> statement-breakpoint
ALTER TABLE "sale_items" ADD COLUMN "price_adjusted_by" integer;--> statement-breakpoint
ALTER TABLE "sale_items" ADD COLUMN "price_adjusted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_price_adjusted_by_users_id_fk" FOREIGN KEY ("price_adjusted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
UPDATE "sale_items" SET "base_unit_price_cents" = "unit_price_cents" WHERE "base_unit_price_cents" IS NULL;--> statement-breakpoint
ALTER TABLE "sale_items" ALTER COLUMN "base_unit_price_cents" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_price_adjustment_ck" CHECK (
  "base_unit_price_cents" >= 0
  AND "unit_price_cents" >= 0
  AND (
    "price_adjustment_type" IS NULL
    OR "price_adjustment_type" IN ('final_unit_price','fixed_discount','percentage_discount','fixed_markup','percentage_markup')
  )
  AND (
    (
      "price_adjustment_type" IS NULL
      AND "price_adjustment_value" IS NULL
      AND "price_adjustment_reason" IS NULL
      AND "price_adjusted_by" IS NULL
      AND "price_adjusted_at" IS NULL
      AND "base_unit_price_cents" = "unit_price_cents"
    )
    OR (
      "price_adjustment_type" IS NOT NULL
      AND "unit_price_cents" > 0
      AND "price_adjustment_value" IS NOT NULL
      AND "price_adjustment_value" >= 0
      AND "price_adjustment_reason" IS NOT NULL
      AND length(trim("price_adjustment_reason")) >= 3
      AND "price_adjusted_by" IS NOT NULL
      AND "price_adjusted_at" IS NOT NULL
      AND "base_unit_price_cents" <> "unit_price_cents"
    )
  )
);
