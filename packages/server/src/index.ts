import "./env.js"; // must be first: loads .env before config reads process.env
import http from "http";
import { Server } from "socket.io";
import { app, corsOptions } from "./server.js";
import { setupSocketHandlers } from "./socket.js";
import { PORT, GDS_SECRET } from "./config.js";

console.log(`Secret is set to ${GDS_SECRET}`);

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: corsOptions.origin, credentials: corsOptions.credentials },
});

setupSocketHandlers(io);

server.listen(PORT, () => {
  console.log("listening on *:" + PORT);
});
