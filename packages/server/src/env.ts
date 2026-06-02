// Ensures variables from this package's .env are in process.env before config.ts
// reads them. Imported first in index.ts.
//
// Under Bun (the project runtime) .env is loaded automatically from the working
// directory, so the explicit load below is a no-op and only the Node fallback
// uses it. A missing file is a silent no-op — in production the real environment
// is used instead.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const envPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.env"
);

// Under plain Node, populate process.env from .env (resolved relative to this
// package so it works regardless of the working directory). Bun has no
// loadEnvFile and auto-loads .env itself, so this branch is skipped there.
if (typeof process.loadEnvFile === "function" && existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

// Bun's .env parser performs $VAR expansion even inside single-quoted values,
// which corrupts JSON configs that legitimately contain "$" — e.g. the Flowr
// query DSL's "$type" discriminators get expanded to "", so channel searches
// fail with HTTP 400 and no channels load. Re-read the raw file and restore any
// value that contains "$" and was altered by expansion. Values without "$" are
// left untouched, so variables overridden via the real environment (PORT,
// GDS_SECRET, …) keep their precedence.
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const key = match[1];
    let value = match[2].trim();
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.at(-1) === quote) {
      value = value.slice(1, -1);
    }
    if (value.includes("$") && process.env[key] !== value) {
      process.env[key] = value;
    }
  }
}
