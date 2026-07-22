ALTER TABLE "sessions" ADD COLUMN "session_type" text DEFAULT 'browser' NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "device_label" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_type_ck" CHECK ("sessions"."session_type" in ('browser','desktop'));