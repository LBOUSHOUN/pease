import Fastify, { LogController } from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import argon2 from "argon2";
import { and, eq, isNull, or, sql as dsql } from "drizzle-orm";
import {
  ownerSchema,
  loginSchema,
  changePasswordSchema,
  accountProfileUpdateSchema,
} from "@maktaba/validation";
import { config } from "./config.js";
import { db, sql } from "./db/index.js";
import { appSettings, auditLogs, sessions, users } from "./db/schema.js";
import {
  authenticate,
  createSession,
  revoke,
  isDesktopRequest,
  safeUser,
  requirePermission,
} from "./auth.js";
import { registerPhase2 } from "./phase2.js";
import { registerPhase3 } from "./phase3.js";
import { registerPhase4 } from "./phase4.js";
import { registerPhase5 } from "./phase5.js";

function hasPostgresCode(error: unknown, code: string): boolean {
  if (!error || typeof error !== "object") return false;
  if ("code" in error && error.code === code) return true;
  return "cause" in error && hasPostgresCode(error.cause, code);
}
import { registerPhase6 } from "./phase6.js";
export async function buildApp() {
  const app = Fastify({
    logger: { level: config.LOG_LEVEL },
    trustProxy:
      config.NODE_ENV === "production" || config.TRUST_PROXY === "true",
    logController: new LogController({
      disableRequestLogging: config.NODE_ENV === "test",
    }),
  });
  const failedLoginAttempts = new Map<string, { count: number; resetAt: number }>();
  const loginRateLimitWindowMs = 5 * 60 * 1000;
  const pruneFailedLoginAttempts = (now = Date.now()) => {
    for (const [key, value] of failedLoginAttempts.entries()) {
      if (value.resetAt <= now) failedLoginAttempts.delete(key);
    }
  };
  const getFailedLoginAttemptState = (key: string, now = Date.now()) => {
    pruneFailedLoginAttempts(now);
    const existing = failedLoginAttempts.get(key);
    if (!existing || existing.resetAt <= now) {
      const fresh = { count: 0, resetAt: now + loginRateLimitWindowMs };
      failedLoginAttempts.set(key, fresh);
      return fresh;
    }
    return existing;
  };
  const allowedOrigins = [
    config.APP_ORIGIN,
    "http://127.0.0.1:5173",
    "tauri://localhost",
    "http://tauri.localhost",
  ];
  await app.register(cookie);
  await app.register(helmet);
  await app.register(cors, {
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
    credentials: true,
  });
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
  app.get("/api/health", async () => ({ status: "ok" }));
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
      const desktopSession = await createSession(created!.id, reply, isDesktopRequest(req));
      return reply.code(201).send({ user: safeUser(created!), desktopSession });
    },
  );
  app.post("/api/auth/login", async (req, reply) => {
    const p = loginSchema.safeParse(req.body);

    if (!p.success) {
      return reply.code(400).send({
        code: "VALIDATION_ERROR",
        message: "Vérifiez les informations saisies.",
        requestId: req.id,
      });
    }

    const normalizedLogin = p.data.login.trim().toLowerCase();
    const loginKey = `${req.ip}:${normalizedLogin}`;
    const now = Date.now();
    const state = getFailedLoginAttemptState(loginKey, now);

    if (state.count >= Number(config.LOGIN_RATE_LIMIT)) {
      reply.header(
        "retry-after",
        Math.max(1, Math.ceil((state.resetAt - now) / 1000)).toString(),
      );
      return reply.code(429).send({
        code: "RATE_LIMITED",
        message: "Trop de tentatives. Réessayez dans quelques minutes.",
        requestId: req.id,
      });
    }

    const found = await db
      .select()
      .from(users)
      .where(
        or(
          dsql`lower(${users.username}) = ${normalizedLogin}`,
          dsql`lower(${users.email}) = ${normalizedLogin}`,
        ),
      )
      .limit(1);

    const u = found[0];
    const passwordIsValid =
      !!u && (await argon2.verify(u.passwordHash, p.data.password));

    if (!passwordIsValid) {
      state.count += 1;
      state.resetAt = Math.max(state.resetAt, now + loginRateLimitWindowMs);
      return reply.code(401).send({
        code: "BAD_CREDENTIALS",
        message: "Identifiant ou mot de passe incorrect.",
        requestId: req.id,
      });
    }

    if (!u.isActive) {
      state.count += 1;
      state.resetAt = Math.max(state.resetAt, now + loginRateLimitWindowMs);
      return reply.code(403).send({
        code: "INACTIVE_USER",
        message: "Compte désactivé",
        requestId: req.id,
      });
    }

    failedLoginAttempts.delete(loginKey);

    await db
      .update(users)
      .set({ lastLoginAt: new Date() })
      .where(eq(users.id, u.id));

    const desktopSession = await createSession(u.id, reply, isDesktopRequest(req));

    return { user: safeUser(u), desktopSession };
  });
  app.post("/api/auth/logout", async (req, reply) => {
    await revoke(req, reply);
    return { ok: true };
  });
  app.get("/api/auth/me", { preHandler: authenticate }, async (req) => ({
    user: req.user,
  }));
  const accountProfile = (u: typeof users.$inferSelect) => ({
    id: u.id,
    fullName: u.fullName,
    username: u.username,
    email: u.email,
    phone: u.phone,
    role: u.role,
    permissions: safeUser(u).permissions,
    isActive: u.isActive,
    createdAt: u.createdAt.toISOString(),
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
  });
  app.get(
    "/api/account/profile",
    { preHandler: authenticate },
    async (req, reply) => {
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, req.user!.id))
        .limit(1);
      if (!user)
        return reply.code(404).send({
          code: "NOT_FOUND",
          message: "Compte introuvable.",
        });
      return { profile: accountProfile(user) };
    },
  );
  app.patch(
    "/api/account/profile",
    {
      preHandler: authenticate,
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
    },
    async (req, reply) => {
      const parsed = accountProfileUpdateSchema.safeParse(req.body);
      if (!parsed.success)
        return reply.code(400).send({
          code: "VALIDATION_ERROR",
          message: "Vérifiez les informations saisies.",
          fieldErrors: parsed.error.flatten().fieldErrors,
        });
      const [current] = await db
        .select()
        .from(users)
        .where(eq(users.id, req.user!.id))
        .limit(1);
      if (!current)
        return reply.code(404).send({
          code: "NOT_FOUND",
          message: "Compte introuvable.",
        });
      const emailChanged = parsed.data.email !== current.email;
      if (
        emailChanged &&
        (!parsed.data.currentPassword ||
          !(await argon2.verify(
            current.passwordHash,
            parsed.data.currentPassword,
          )))
      )
        return reply.code(400).send({
          code: "WRONG_PASSWORD",
          message:
            "Le mot de passe actuel est requis pour modifier l’adresse e-mail.",
        });
      try {
        const updated = await db.transaction(async (tx) => {
          const [row] = await tx
            .update(users)
            .set({
              fullName: parsed.data.fullName,
              phone: parsed.data.phone || null,
              email: parsed.data.email || null,
              updatedAt: new Date(),
            })
            .where(eq(users.id, req.user!.id))
            .returning();
          await tx.insert(auditLogs).values({
            userId: req.user!.id,
            action: "account.profile_updated",
            entityType: "user",
            entityId: req.user!.id,
            newValuesJson: JSON.stringify({
              fullName: row!.fullName,
              phoneChanged: row!.phone !== current.phone,
              emailChanged,
            }),
          });
          return row!;
        });
        return { profile: accountProfile(updated) };
      } catch (error) {
        if (hasPostgresCode(error, "23505"))
          return reply.code(409).send({
            code: "CONFLICT",
            message: "Cette adresse e-mail est déjà utilisée.",
          });
        throw error;
      }
    },
  );
  for (const path of [
    "/api/account/change-password",
    "/api/auth/change-password",
  ] as const)
  app.post(
    path,
    {
      preHandler: authenticate,
      config: { rateLimit: { max: 5, timeWindow: "5 minutes" } },
    },
    async (req, reply) => {
      const p = changePasswordSchema.safeParse(req.body);
      if (!p.success)
        return reply.code(400).send({
          code: "VALIDATION_ERROR",
          message: "Vérifiez le nouveau mot de passe.",
          fieldErrors: p.error.flatten().fieldErrors,
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
      await db.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.userId, u.id), isNull(sessions.revokedAt)));
      const desktopSession = await createSession(u.id, reply, isDesktopRequest(req));
      await db.insert(auditLogs).values({
        userId: u.id,
        action: "password.changed",
        entityType: "user",
        entityId: u.id,
      });
      return { user: safeUser(u), desktopSession };
    },
  );
  app.get(
    "/api/dashboard",
    { preHandler: requirePermission("dashboard.view") },
    async () => ({ online: true, message: "API connectée" }),
  );
  await registerPhase2(app);
  await registerPhase3(app);
  await registerPhase4(app);
  await registerPhase5(app);
  await registerPhase6(app);
  return app;
}
