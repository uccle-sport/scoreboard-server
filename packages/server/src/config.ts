export const PORT = Number(process.env.PORT) || 5000;

const rawCorsOrigin = process.env.CORS_ORIGIN || "*";
export const CORS_ORIGIN =
  rawCorsOrigin === "*" ? "*" : rawCorsOrigin.split(",").map((s) => s.trim());

export const GDS_SECRET = process.env.GDS_SECRET || "Secret";

// Single bearer token (from .env) injected into every Flowr request — the device
// webhooks, the channel search, and the channel-logo image proxy.
export const FLOWR_BEARER = process.env.FLOWR_BEARER;

// URL template for channel logos, with a `{logo}` placeholder replaced by the
// numeric Flowr view id. Used by the /channel-logo proxy to fetch the image.
export const FLOWR_LOGO_URL_TEMPLATE = process.env.FLOWR_LOGO_URL_TEMPLATE;

// How long temporary control lasts from the moment it is claimed. Overridable so
// the e2e suite can watch a claim lapse without waiting 90 minutes.
export const CONTROL_TTL_MS =
  Number(process.env.CONTROL_TTL_MS) || 90 * 60 * 1000;

// How long a phone stays unlocked for TV / Signage switching after entering a
// source PIN. Long-lived by design ("once per phone"), but not forever — a
// visiting team's phone should not keep access for a whole season.
export const SOURCE_GRANT_TTL_MS =
  Number(process.env.SOURCE_GRANT_TTL_MS) || 30 * 24 * 60 * 60 * 1000;

// `GDS_SECRET` authorises *observation* only — it is in the URL, in browser
// history and in shared screenshots, so it cannot be a mutation credential.
// Mutating handlers additionally require a PIN-derived grant (see access.ts).
export const validateToken = (token: string): boolean => GDS_SECRET === token;
