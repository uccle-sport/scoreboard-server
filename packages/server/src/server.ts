import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { CORS_ORIGIN } from "./config.js";

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

export { corsOptions };
