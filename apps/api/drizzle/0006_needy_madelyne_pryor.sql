CREATE TABLE "backups" (
	"id" serial PRIMARY KEY NOT NULL,
	"filename" text NOT NULL,
	"size_bytes" bigint DEFAULT 0 NOT NULL,
	"checksum_sha256" text,
	"status" text DEFAULT 'creating' NOT NULL,
	"created_by" integer NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "backups_filename_unique" UNIQUE("filename"),
	CONSTRAINT "backups_status_ck" CHECK ("backups"."status" in ('creating','ready','verified','failed','restoring')),
	CONSTRAINT "backups_size_ck" CHECK ("backups"."size_bytes">=0)
);
--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "timezone" text DEFAULT 'Africa/Casablanca' NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "show_barcode_on_receipt" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "show_qr_on_label" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "show_price_on_label" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "label_size" text DEFAULT '40x30' NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "backup_retention" integer DEFAULT 7 NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "session_timeout_minutes" integer DEFAULT 720 NOT NULL;--> statement-breakpoint
ALTER TABLE "backups" ADD CONSTRAINT "backups_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "backups_created_idx" ON "backups" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_user_date_idx" ON "audit_logs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_action_date_idx" ON "audit_logs" USING btree ("action","created_at");--> statement-breakpoint
CREATE INDEX "audit_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id","created_at");--> statement-breakpoint
CREATE INDEX "users_name_idx" ON "users" USING btree ("full_name");