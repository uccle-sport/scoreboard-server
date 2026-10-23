import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { CORS_ORIGIN } from "./config.js";
import { scoreBoards } from "./state.js";
import { channelLogoHandler } from "./socket.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Built frontends. Resolved next to the sources by default; the Docker image runs a
// `bun build --compile` executable (where import.meta.url points into the embedded
// /$bunfs filesystem), so it sets PUBLIC_DIR to the copied public/ folder instead.
const publicDir = path.resolve(process.env.PUBLIC_DIR ?? path.join(__dirname, "../public"));

const corsOptions = {
  origin: CORS_ORIGIN,
  credentials: true,
};

export const app = express();
app.use(cors(corsOptions));

// Proxy channel logos with the bearer attached (browsers can't set it on <img>).
app.get("/channel-logo/:logo", channelLogoHandler);

app.use(express.static(publicDir));
app.get("/", (_req, res) =>
  res.sendFile(path.join(publicDir, "index.html"))
);

// Harmless target for the device-webhook config in the e2e suite, so
// flowrCommand has something to POST to that isn't a real Flowr instance.
app.all("/debug/noop", (_req, res) => res.json({ ok: true }));

// Debug endpoint for E2E tests
app.get("/debug/sockets/:uuid", (_req, res) => {
  const uuid = _req.params.uuid;
  const count = scoreBoards[uuid]?.length ?? 0;
  res.json({ uuid, sockets: count });
});

export { corsOptions };
