ALTER TABLE "products" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "archived_by" integer;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_archived_by_users_id_fk" FOREIGN KEY ("archived_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
UPDATE "app_settings"
SET "shop_name" = 'Double Library', "updated_at" = now()
WHERE lower(trim("shop_name")) IN ('maktaba', 'maktaba pos', 'librarie doubel', 'doubel library', 'double librarie', 'library doubel');
