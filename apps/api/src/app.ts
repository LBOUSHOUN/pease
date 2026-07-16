import Fastify, { LogController } from "fastify";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import argon2 from "argon2";
import { eq, or, sql as dsql } from "drizzle-orm";
import {
  ownerSchema,
  loginSchema,
  changePasswordSchema,
} from "@maktaba/validation";
import { config } from "./config.js";
import { db, sql } from "./db/index.js";
import { appSettings, auditLogs, users } from "./db/schema.js";
import {
  authenticate,
  createSession,
  revoke,
  safeUser,
  requirePermission,
} from "./auth.js";
export async function buildApp() {
  const app = Fastify({
    logger: { level: config.LOG_LEVEL },
    trustProxy: config.TRUST_PROXY === "true",
    logController: new LogController({
      disableRequestLogging: config.NODE_ENV === "test",
    }),
  });
  await app.register(cookie);
  await app.register(helmet);
  await app.register(rateLimit, { global: false });
  app.setErrorHandler((e, req, reply) => {
    const status = (e as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500)
      req.log.error({ err: e, requestId: req.id }, "request failed");
    const normalized =
      status === 429
        ? {
            code: "RATE_LIMITED",
            message: "Trop de tentatives. Réessayez dans quelques minutes.",
          }
        : status === 409
          ? {
              code: "CONFLICT",
              message:
                "Cette opération entre en conflit avec les données actuelles.",
            }
          : status === 400
            ? {
                code: "VALIDATION_ERROR",
                message: "Vérifiez les informations saisies.",
              }
            : {
                code: "INTERNAL_ERROR",
                message:
                  "Une erreur interne est survenue. Réessayez plus tard.",
              };
    reply.code(status).send({ ...normalized, requestId: req.id });
  });
  app.get("/health", async () => ({ status: "ok" }));
  app.get("/ready", async (_req, reply) => {
    try {
      await sql`select 1`;
      return { status: "ready" };
    } catch {
      return reply.code(503).send({ status: "not_ready" });
    }
  });
  app.get("/api/bootstrap/status", async () => {
    const found = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.role, "global_admin"))
      .limit(1);
    return { needsOnboarding: found.length === 0 };
  });
  app.post(
    "/api/bootstrap/owner",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const parsed = ownerSchema.safeParse(req.body);
      if (!parsed.success)
        return reply.code(400).send({
          code: "VALIDATION_ERROR",
          message: "Données invalides",
          fieldErrors: parsed.error.flatten().fieldErrors,
          requestId: req.id,
        });
      const x = parsed.data;
      let created: typeof users.$inferSelect | undefined;
      await db.transaction(async (tx) => {
        const lock = await tx.execute(
          dsql`select pg_advisory_xact_lock(829174)`,
        );
        void lock;
        const exists = await tx
          .select({ id: users.id })
          .from(users)
          .where(eq(users.role, "global_admin"))
          .limit(1);
        if (exists.length)
          throw Object.assign(new Error("Bootstrap fermé"), {
            statusCode: 409,
          });
        await tx.insert(appSettings).values({
          id: 1,
          shopName: x.shopName,
          barcodePrefix: x.barcodePrefix.toUpperCase(),
        });
        [created] = await tx
          .insert(users)
          .values({
            fullName: x.fullName,
            username: x.username,
            email: x.email || null,
            passwordHash: await argon2.hash(x.password),
            role: "global_admin",
          })
          .returning();
        await tx.insert(auditLogs).values({
          userId: created!.id,
          action: "owner.created",
          entityType: "user",
          entityId: created!.id,
        });
      });
      await createSession(created!.id, reply);
      return reply.code(201).send({ user: safeUser(created!) });
    },
  );
  app.post(
    "/api/auth/login",
    {
      config: {
        rateLimit: { max: config.LOGIN_RATE_LIMIT, timeWindow: "5 minutes" },
      },
    },
    async (req, reply) => {
      const p = loginSchema.safeParse(req.body);
      if (!p.success)
        return reply.code(400).send({
          code: "VALIDATION_ERROR",
          message: "Vérifiez les informations saisies.",
          requestId: req.id,
        });
      const found = await db
        .select()
        .from(users)
        .where(
          or(
            dsql`lower(${users.username}) = ${p.data.login}`,
            dsql`lower(${users.email}) = ${p.data.login}`,
          ),
        )
        .limit(1);
      const u = found[0];
      if (!u || !(await argon2.verify(u.passwordHash, p.data.password)))
        return reply.code(401).send({
          code: "BAD_CREDENTIALS",
          message: "Identifiant ou mot de passe incorrect.",
          requestId: req.id,
        });
      if (!u.isActive)
        return reply.code(403).send({
          code: "INACTIVE_USER",
          message: "Compte désactivé",
          requestId: req.id,
        });
      await db
        .update(users)
        .set({ lastLoginAt: new Date() })
        .where(eq(users.id, u.id));
      await createSession(u.id, reply);
      return { user: safeUser(u) };
    },
  );
  app.post("/api/auth/logout", async (req, reply) => {
    await revoke(req, reply);
    return { ok: true };
  });
  app.get("/api/auth/me", { preHandler: authenticate }, async (req) => ({
    user: req.user,
  }));
  app.post(
    "/api/auth/change-password",
    { preHandler: authenticate },
    async (req, reply) => {
      const p = changePasswordSchema.safeParse(req.body);
      if (!p.success)
        return reply.code(400).send({
          code: "VALIDATION_ERROR",
          message: "Mot de passe trop faible",
        });
      const found = await db
          .select()
          .from(users)
          .where(eq(users.id, req.user!.id))
          .limit(1),
        u = found[0]!;
      if (!(await argon2.verify(u.passwordHash, p.data.currentPassword)))
        return reply.code(400).send({
          code: "WRONG_PASSWORD",
          message: "Mot de passe actuel incorrect",
        });
      if (await argon2.verify(u.passwordHash, p.data.newPassword))
        return reply.code(400).send({
          code: "SAME_PASSWORD",
          message: "Choisissez un mot de passe différent",
        });
      u.mustChangePassword = false;
      await db
        .update(users)
        .set({
          passwordHash: await argon2.hash(p.data.newPassword),
          mustChangePassword: false,
          updatedAt: new Date(),
        })
        .where(eq(users.id, u.id));
      await db.insert(auditLogs).values({
        userId: u.id,
        action: "password.changed",
        entityType: "user",
        entityId: u.id,
      });
      return { user: safeUser(u) };
    },
  );
  app.get(
    "/api/dashboard",
    { preHandler: requirePermission("dashboard.view") },
    async () => ({ online: true, message: "API connectée" }),
  );
  return app;
}
