import { createHash, randomBytes } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "./db/index.js";
import { sessions, users } from "./db/schema.js";
import { config } from "./config.js";
import { permissions } from "./permissions.js";
import type { Role, SafeUser } from "@maktaba/shared-types";
const cookie = "maktaba_session";
const hash = (token: string) =>
  createHash("sha256")
    .update(`${token}:${config.SESSION_PEPPER}`)
    .digest("hex");
export function safeUser(u: typeof users.$inferSelect): SafeUser {
  return {
    id: u.id,
    fullName: u.fullName,
    username: u.username,
    email: u.email,
    role: u.role as Role,
    mustChangePassword: u.mustChangePassword,
    permissions: permissions(u.role as Role),
  };
}
export async function createSession(userId: number, reply: FastifyReply) {
  const token = randomBytes(32).toString("base64url"),
    expires = new Date(Date.now() + 1000 * 60 * 60 * 12);
  await db
    .insert(sessions)
    .values({ userId, tokenHash: hash(token), expiresAt: expires });
  reply.setCookie(cookie, token, {
    httpOnly: true,
    secure: config.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires,
  });
}
export async function revoke(req: FastifyRequest, reply: FastifyReply) {
  const token = req.cookies[cookie];
  if (token)
    await db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(eq(sessions.tokenHash, hash(token)));
  reply.clearCookie(cookie, { path: "/" });
}
export async function authenticate(req: FastifyRequest, reply: FastifyReply) {
  const token = req.cookies[cookie];
  if (!token)
    return reply
      .code(401)
      .send({
        code: "UNAUTHENTICATED",
        message: "Veuillez vous connecter",
        requestId: req.id,
      });
  const rows = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(
      and(
        eq(sessions.tokenHash, hash(token)),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, new Date()),
        eq(users.isActive, true),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row)
    return reply
      .code(401)
      .send({
        code: "SESSION_INVALID",
        message: "Session expirée",
        requestId: req.id,
      });
  req.user = safeUser(row.user);
}
export function requirePermission(permission: string) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    await authenticate(req, reply);
    if (reply.sent) return;
    if (req.user?.mustChangePassword)
      return reply
        .code(403)
        .send({
          code: "PASSWORD_CHANGE_REQUIRED",
          message: "Changez votre mot de passe",
          requestId: req.id,
        });
    if (!req.user?.permissions.includes(permission))
      return reply
        .code(403)
        .send({
          code: "FORBIDDEN",
          message: "Autorisation insuffisante",
          requestId: req.id,
        });
  };
}
declare module "fastify" {
  interface FastifyRequest {
    user?: SafeUser;
  }
}
