ALTER TABLE "cash_register_sessions" ADD COLUMN "closed_by" integer;
ALTER TABLE "cash_register_sessions" ADD CONSTRAINT "cash_register_sessions_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
DROP INDEX IF EXISTS "one_open_register";
CREATE UNIQUE INDEX "one_open_register" ON "cash_register_sessions" ((1)) WHERE "status"='open';
