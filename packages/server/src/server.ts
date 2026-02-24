import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { CORS_ORIGIN } from "./config.js";
import { scoreBoards } from "./state.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const corsOptions = {
  origin: CORS_ORIGIN,
  credentials: true,
};

export const app = express();
app.use(cors(corsOptions));
app.use(express.static(path.join(__dirname, "../public")));
app.get("/", (_req, res) =>
  res.sendFile(path.join(__dirname, "../public/index.html"))
);

// Debug endpoint for E2E tests
app.get("/debug/sockets/:uuid", (_req, res) => {
  const uuid = _req.params.uuid;
  const count = scoreBoards[uuid]?.length ?? 0;
  res.json({ uuid, sockets: count });
});

export { corsOptions };
