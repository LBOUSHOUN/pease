import { createHash, randomBytes } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { eq } from "drizzle-orm";
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
export type CreatedSession = { token: string; expiresAt: string };
export function isDesktopRequest(req: FastifyRequest) {
  const origin = req.headers.origin;
  return req.headers["x-maktaba-client"] === "tauri-desktop" &&
    (origin === "http://tauri.localhost" || origin === "tauri://localhost");
}
export async function createSession(userId: number, reply: FastifyReply, desktop = false): Promise<CreatedSession | undefined> {
  const token = randomBytes(32).toString("base64url"),
    expires = new Date(Date.now() + 1000 * 60 * 60 * 12);
  await db
    .insert(sessions)
    .values({ userId, tokenHash: hash(token), expiresAt: expires, sessionType: desktop ? "desktop" : "browser", deviceLabel: desktop ? "Maktaba POS Desktop" : null });
  if (desktop) return { token, expiresAt: expires.toISOString() };
  reply.setCookie(cookie, token, {
    httpOnly: true,
    secure: config.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires,
  });
}
export async function revoke(req: FastifyRequest, reply: FastifyReply) {
  const token = bearer(req) ?? req.cookies[cookie];
  if (token)
    await db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(eq(sessions.tokenHash, hash(token)));
  reply.clearCookie(cookie, {
    httpOnly: true,
    secure: config.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  });
}
export async function authenticate(req: FastifyRequest, reply: FastifyReply) {
  const token = bearer(req) ?? req.cookies[cookie];
  if (!token)
    return reply.code(401).send({
      code: "UNAUTHENTICATED",
      message: "Veuillez vous connecter",
      requestId: req.id,
    });
  const rows = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.tokenHash, hash(token)))
    .limit(1);
  const row = rows[0];
  if (!row)
    return reply.code(401).send({
      code: "SESSION_INVALID",
      message: "Session expirée",
      requestId: req.id,
    });
  if (row.session.revokedAt || !row.user.isActive)
    return reply.code(401).send({ code: "SESSION_REVOKED", message: "Session révoquée", requestId: req.id });
  if (row.session.expiresAt <= new Date())
    return reply.code(401).send({ code: "SESSION_EXPIRED", message: "Session expirée", requestId: req.id });
  req.user = safeUser(row.user);
  await db.update(sessions).set({ lastSeenAt: new Date() }).where(eq(sessions.id, row.session.id));
}
function bearer(req: FastifyRequest) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return undefined;
  const token = header.slice(7).trim();
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : undefined;
}
export function requirePermission(permission: string) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    await authenticate(req, reply);
    if (reply.sent) return;
    if (req.user?.mustChangePassword)
      return reply.code(403).send({
        code: "PASSWORD_CHANGE_REQUIRED",
        message: "Changez votre mot de passe",
        requestId: req.id,
      });
    if (!req.user?.permissions.includes(permission))
      return reply.code(403).send({
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
