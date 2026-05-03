import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const ROOT_DIR = process.cwd();
const SRC_DIR = path.join(ROOT_DIR, "src");

const FORBIDDEN_PATTERNS = [
  { test: (value) => value.startsWith("@/"), label: "@/ alias" },
  { test: (value) => value.startsWith("app/"), label: "app/" },
  {
    test: (value) => value.startsWith("components/chatbot/"),
    label: "components/chatbot/",
  },
  { test: (value) => value.startsWith("lib/db/"), label: "lib/db/" },
  { test: (value) => value.startsWith("artifacts/"), label: "artifacts/" },
];

const IMPORT_REGEXES = [
  /\bimport\s+(?:type\s+)?[^;]*?\sfrom\s*["']([^"']+)["']/g,
  /\bexport\s+(?:type\s+)?[^;]*?\sfrom\s*["']([^"']+)["']/g,
  /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
];

async function getFilesRecursively(dirPath) {
  const entries = await readdir(dirPath, { withFileTypes: true });
  const filePaths = await Promise.all(
    entries.map((entry) => {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        return getFilesRecursively(fullPath);
      }
      if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
        return [fullPath];
      }
      return [];
    })
  );

  return filePaths.flat();
}

function collectImportSources(contents) {
  const matches = [];
  for (const regex of IMPORT_REGEXES) {
    const sourceMatches = [...contents.matchAll(regex)].map((m) => m[1]);
    matches.push(...sourceMatches);
  }
  return matches;
}

function findForbiddenSource(source) {
  return FORBIDDEN_PATTERNS.find((pattern) => pattern.test(source));
}

async function main() {
  const files = await getFilesRecursively(SRC_DIR);
  const violations = [];

  for (const absolutePath of files) {
    const contents = await readFile(absolutePath, "utf8");
    const sources = collectImportSources(contents);
    for (const source of sources) {
      const forbidden = findForbiddenSource(source);
      if (forbidden) {
        violations.push({
          file: path.relative(ROOT_DIR, absolutePath),
          source,
          label: forbidden.label,
        });
      }
    }
  }

  if (violations.length === 0) {
    console.log("Boundary check passed for src/ imports.");
    return;
  }

  console.error("Boundary check failed. Forbidden imports found in src/:");
  for (const violation of violations) {
    console.error(
      `- ${violation.file}: "${violation.source}" (${violation.label})`
    );
  }

  process.exitCode = 1;
}

main().catch((error) => {
  console.error("Boundary check failed with an unexpected error.");
  console.error(error);
  process.exitCode = 1;
});
