/**
 * Rewrites @/ alias imports inside src/ to relative paths.
 * Run: node scripts/fix-src-imports.mjs
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const SRC = path.join(ROOT, "src");

// Maps @/X → the resolved absolute path within the project.
// Order matters: longer/more-specific prefixes first.
const ALIAS_MAP = [
  // within-src component and hook aliases
  ["@/components/ai-elements/", path.join(SRC, "components/ai-elements/")],
  ["@/components/chatbot/", path.join(SRC, "components/chatbot/")],
  ["@/components/theme-provider", path.join(SRC, "components/theme-provider")],
  ["@/components/ui/", path.join(SRC, "components/ui/")],
  ["@/hooks/", path.join(SRC, "hooks/")],
  // @/src/core/* — the @/* catch-all maps to root, so @/src/core/X = src/core/X
  ["@/src/core/", path.join(SRC, "core/")],
  // lib aliases — point to new src/lib/ homes
  ["@/lib/types", path.join(SRC, "core/types")],
  ["@/lib/db/schema", path.join(SRC, "core/types")],
  ["@/lib/editor/", path.join(SRC, "lib/editor/")],
  ["@/lib/utils", path.join(SRC, "lib/utils")],
  ["@/lib/errors", path.join(SRC, "lib/errors")],
  ["@/lib/constants", path.join(SRC, "lib/constants")],
  // intentionally NOT rewriting @/lib/ai/models or @/artifacts/* — Phase B
];

async function getFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((e) => {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) return getFiles(full);
      if (e.isFile() && /\.(ts|tsx)$/.test(e.name)) return [full];
      return [];
    }),
  );
  return files.flat();
}

function resolveAlias(importPath) {
  for (const [prefix, target] of ALIAS_MAP) {
    if (importPath === prefix.replace(/\/$/, "") || importPath.startsWith(prefix)) {
      return target + importPath.slice(prefix.length);
    }
  }
  return null;
}

function toRelative(fromFile, toAbsolute) {
  const fromDir = path.dirname(fromFile);
  let rel = path.relative(fromDir, toAbsolute);
  if (!rel.startsWith(".")) rel = "./" + rel;
  return rel;
}

const IMPORT_RE = /(['"])(@\/[^'"]+)\1/g;

async function processFile(file) {
  const original = await readFile(file, "utf8");
  const updated = original.replace(IMPORT_RE, (match, quote, importPath) => {
    const resolved = resolveAlias(importPath);
    if (!resolved) return match; // leave unchanged
    const rel = toRelative(file, resolved);
    return `${quote}${rel}${quote}`;
  });
  if (updated !== original) {
    await writeFile(file, updated, "utf8");
    console.log("updated:", path.relative(ROOT, file));
  }
}

const files = await getFiles(SRC);
await Promise.all(files.map(processFile));
console.log(`Done. Processed ${files.length} files.`);
