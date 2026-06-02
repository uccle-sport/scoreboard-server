// Loads environment variables from a local .env file when present, using Node's
// built-in loader (no dependency). Imported first in index.ts so the variables are
// available before config.ts reads process.env. A missing .env is a no-op — in
// production the real environment is used instead.
try {
  process.loadEnvFile();
  console.log(JSON.stringify(process.env), null, " ")
} catch {
  console.error("No .env file present")
  // No .env file present — rely on the real environment.
}
