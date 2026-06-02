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

export const validateToken = (token: string): boolean => GDS_SECRET === token;
