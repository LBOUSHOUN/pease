import argon2 from "argon2";
import postgres from "postgres";
import { changePasswordSchema } from "@maktaba/validation";

const LOCAL_DATABASE_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export type LocalPasswordResetResult = {
  username: string;
  revokedSessions: number;
};

export function assertLocalPasswordResetAllowed(
  databaseUrl: string,
  nodeEnv: string | undefined,
): URL {
  if (nodeEnv === "production") {
    throw new Error(
      "La réinitialisation locale est interdite avec NODE_ENV=production.",
    );
  }
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new Error("La configuration de la base locale est invalide.");
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !LOCAL_DATABASE_HOSTS.has(hostname)
  ) {
    throw new Error(
      "Commande refusée : DATABASE_URL ne cible pas PostgreSQL sur localhost.",
    );
  }
  return url;
}

export function validateLocalResetPassword(
  password: string,
  confirmation: string,
): string {
  const parsed = changePasswordSchema.safeParse({
    currentPassword: "local-reset-validation-only",
    newPassword: password,
    confirmation,
  });
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Mot de passe invalide.");
  }
  return parsed.data.newPassword;
}

export async function resetLocalUserPassword(input: {
  databaseUrl: string;
  nodeEnv: string | undefined;
  login: string;
  password: string;
}): Promise<LocalPasswordResetResult> {
  assertLocalPasswordResetAllowed(input.databaseUrl, input.nodeEnv);
  const login = input.login.trim().toLowerCase();
  if (!login) throw new Error("Le login est requis.");
  const password = validateLocalResetPassword(input.password, input.password);

  const sql = postgres(input.databaseUrl, { max: 1 });
  try {
    const passwordHash = await argon2.hash(password);
    return await sql.begin(async (tx) => {
      const matches = await tx<{ id: number; username: string }[]>`
        select id, username from users
        where lower(trim(username)) = ${login}
        for update
      `;
      if (matches.length === 0) {
        throw new Error(
          "Utilisateur local introuvable. Aucun utilisateur n’a été créé.",
        );
      }
      if (matches.length !== 1) {
        throw new Error(
          "Plusieurs utilisateurs locaux correspondent à ce login. Aucune modification effectuée.",
        );
      }

      const user = matches[0]!;
      await tx`
        update users
        set password_hash = ${passwordHash}, updated_at = now()
        where id = ${user.id}
      `;
      const revoked = await tx<{ id: number }[]>`
        update sessions set revoked_at = now()
        where user_id = ${user.id} and revoked_at is null
        returning id
      `;
      return { username: user.username, revokedSessions: revoked.length };
    });
  } finally {
    await sql.end();
  }
}
