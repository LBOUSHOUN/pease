import net from "node:net";
import { execFileSync } from "node:child_process";

const host = "127.0.0.1";
const ports = [3000, 5173];

function ownerOnWindows(port) {
  if (process.platform !== "win32") return undefined;
  try {
    const output = execFileSync("netstat", ["-ano", "-p", "tcp"], {
      encoding: "utf8",
      windowsHide: true,
    });
    const match = output
      .split(/\r?\n/)
      .find((line) => line.includes(`:${port}`) && /LISTENING\s+\d+\s*$/.test(line));
    return match?.trim().match(/(\d+)$/)?.[1];
  } catch {
    return undefined;
  }
}

function assertFree(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", (error) => {
      if (error.code !== "EADDRINUSE") return reject(error);
      const pid = ownerOnWindows(port);
      const owner = pid ? ` (PID ${pid})` : "";
      reject(
        new Error(
          `Le port ${port} est déjà occupé${owner}. Vérifiez avec: Get-NetTCPConnection -LocalPort ${port} | Select-Object OwningProcess. Arrêtez uniquement le processus identifié avec: Stop-Process -Id <PID>.`,
        ),
      );
    });
    server.listen({ host, port, exclusive: true }, () => server.close(resolve));
  });
}

try {
  await Promise.all(ports.map(assertFree));
  console.log(`Préflight réussi : ${host}:3000 et ${host}:5173 sont disponibles.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
