import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import {
  assertLocalPasswordResetAllowed,
  resetLocalUserPassword,
  validateLocalResetPassword,
} from "./local-password-reset.js";

function readLogin(args: string[]): string {
  if (args.some((arg) => /^--password(?:=|$)/i.test(arg))) {
    throw new Error(
      "Ne transmettez jamais le mot de passe dans la ligne de commande.",
    );
  }
  const index = args.indexOf("--login");
  const inline = args.find((arg) => arg.startsWith("--login="));
  const login = inline?.slice("--login=".length) ?? args[index + 1];
  if (!login?.trim()) {
    throw new Error("Usage : npm run user:reset-local -- --login yassin");
  }
  return login;
}

async function readHidden(prompt: string): Promise<string> {
  const input = process.stdin;
  const output = process.stdout;
  if (!input.isTTY || !output.isTTY || !input.setRawMode) {
    throw new Error(
      "Cette commande nécessite un terminal interactif pour masquer le mot de passe.",
    );
  }
  output.write(prompt);
  input.setRawMode(true);
  input.resume();
  input.setEncoding("utf8");

  return new Promise((resolveValue, reject) => {
    let value = "";
    const finish = (error?: Error) => {
      input.off("data", onData);
      input.setRawMode(false);
      input.pause();
      output.write("\n");
      if (error) reject(error);
      else resolveValue(value);
    };
    const onData = (chunk: string) => {
      for (const character of chunk) {
        if (character === "\u0003") {
          finish(new Error("Réinitialisation annulée."));
          return;
        }
        if (character === "\r" || character === "\n") {
          finish();
          return;
        }
        if (character === "\u007f" || character === "\b") {
          value = value.slice(0, -1);
        } else if (character >= " ") {
          value += character;
        }
      }
    };
    input.on("data", onData);
  });
}

export async function runLocalPasswordReset(
  args = process.argv.slice(2),
): Promise<void> {
  loadEnv({
    path: fileURLToPath(new URL("../.env", import.meta.url)),
    override: false,
    quiet: true,
  });
  const login = readLogin(args);
  assertLocalPasswordResetAllowed(
    process.env.DATABASE_URL ?? "",
    process.env.NODE_ENV,
  );
  const password = await readHidden("Nouveau mot de passe : ");
  const confirmation = await readHidden("Confirmez le mot de passe : ");
  const validatedPassword = validateLocalResetPassword(password, confirmation);
  const result = await resetLocalUserPassword({
    databaseUrl: process.env.DATABASE_URL ?? "",
    nodeEnv: process.env.NODE_ENV,
    login,
    password: validatedPassword,
  });
  process.stdout.write(
    `Mot de passe local mis à jour pour ${result.username}. ` +
      `${result.revokedSessions} session(s) invalidée(s). ` +
      "Seule la base PostgreSQL locale a été modifiée.\n",
  );
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isDirectExecution) {
  runLocalPasswordReset().catch((error: unknown) => {
    const message =
      error instanceof Error ? error.message : "Réinitialisation locale échouée.";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
