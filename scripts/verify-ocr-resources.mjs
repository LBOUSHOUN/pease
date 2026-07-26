import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const ocr = resolve(root, "apps/desktop/src-tauri/resources/ocr");
const required = new Map([
  ["tessdata/ara.traineddata", "e3206d3dc87fd50c24a0fb9f01838615911d25168f4e64415244b67d2bb3e729"],
  ["tessdata/eng.traineddata", "7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2"],
  ["tessdata/fra.traineddata", "ced037562e8c80c13122dece28dd477d399af80911a28791a66a63ac1e3445ca"],
]);

const failures = [];
const executable = resolve(ocr, "tesseract.exe");
if (!existsSync(executable) || statSync(executable).size < 100_000) {
  failures.push("tesseract.exe absent ou invalide");
}

const hashFile = (file) =>
  createHash("sha256").update(readFileSync(file)).digest("hex");

const manifestPath = resolve(ocr, "ocr-runtime-manifest.json");
let manifest = null;
if (!existsSync(manifestPath)) {
  failures.push("manifeste du runtime OCR absent");
} else {
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8").replace(/^\uFEFF/u, ""));
  } catch {
    failures.push("manifeste du runtime OCR invalide");
  }
}

if (manifest) {
  if (
    manifest.schemaVersion !== 1 ||
    !manifest.runtimeVersion ||
    manifest.executable?.name !== "tesseract.exe" ||
    !Array.isArray(manifest.dlls) ||
    manifest.dlls.length === 0
  ) {
    failures.push("contenu du manifeste du runtime OCR invalide");
  } else {
    if (
      existsSync(executable) &&
      hashFile(executable) !== manifest.executable.sha256
    ) {
      failures.push("tesseract.exe ne correspond pas au manifeste");
    }
    for (const dependency of manifest.dlls) {
      if (
        typeof dependency.name !== "string" ||
        !dependency.name.toLowerCase().endsWith(".dll") ||
        typeof dependency.sha256 !== "string"
      ) {
        failures.push("entrée DLL invalide dans le manifeste");
        continue;
      }
      const file = resolve(ocr, dependency.name);
      if (!existsSync(file)) {
        failures.push(`${dependency.name} absent`);
      } else if (hashFile(file) !== dependency.sha256) {
        failures.push(`${dependency.name} ne correspond pas au manifeste`);
      }
    }
  }
}

for (const [relative, expected] of required) {
  const file = resolve(ocr, relative);
  if (!existsSync(file)) {
    failures.push(`${relative} absent`);
    continue;
  }
  if (hashFile(file) !== expected) {
    failures.push(`${relative} a une empreinte inattendue`);
  }
}

if (!existsSync(resolve(ocr, "tessdata/configs/tsv"))) {
  failures.push("configuration TSV Tesseract absente");
}

if (failures.length === 0) {
  const version = spawnSync(executable, ["--version"], {
    encoding: "utf8",
    windowsHide: true,
  });
  const versionOutput = `${version.stdout ?? ""}\n${version.stderr ?? ""}`;
  if (version.status !== 0 || !/\btesseract v5\./iu.test(versionOutput)) {
    failures.push("le runtime Tesseract 5 empaqueté ne peut pas être exécuté");
  }

  const languages = spawnSync(
    executable,
    ["--tessdata-dir", resolve(ocr, "tessdata"), "--list-langs"],
    { encoding: "utf8", windowsHide: true },
  );
  const languageLines = `${languages.stdout ?? ""}\n${languages.stderr ?? ""}`
    .split(/\r?\n/u)
    .map((line) => line.trim());
  if (languages.status !== 0) {
    failures.push("le runtime empaqueté ne peut pas lire le tessdata du projet");
  }
  for (const language of ["fra", "ara", "eng"]) {
    if (!languageLines.includes(language)) {
      failures.push(`langue ${language} indisponible dans le runtime empaqueté`);
    }
  }
}

if (failures.length) {
  console.error(`Ressources OCR Windows incomplètes:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}

console.log(
  `Ressources OCR vérifiées: Tesseract ${manifest.runtimeVersion}, ${manifest.dlls.length} DLL, fra+ara+eng.`,
);
