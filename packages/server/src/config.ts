export const PORT = Number(process.env.PORT) || 5000;

const rawCorsOrigin = process.env.CORS_ORIGIN || "*";
export const CORS_ORIGIN =
  rawCorsOrigin === "*" ? "*" : rawCorsOrigin.split(",").map((s) => s.trim());

export const GDS_SECRET = process.env.GDS_SECRET || "Secret";

export const validateToken = (token: string): boolean => GDS_SECRET === token;
