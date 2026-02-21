import type { Server } from "socket.io";
import { v4 as uuidv4 } from "uuid";
import { validateToken } from "./config.js";
import { scoreBoards, state, forward, register } from "./state.js";
import type { PowerCommand, PowerMessage, UpdateMessage } from "./types.js";

async function doPowerRequest(envVarKey: string): Promise<{ status: number }> {
  const command = process.env[envVarKey];
  if (!command) return { status: 404 };

  let parsedCommand: PowerCommand;
  try {
    parsedCommand = JSON.parse(command);
  } catch (e) {
    console.error("Invalid JSON for", envVarKey, e);
    return { status: 400 };
  }
  if (!parsedCommand?.url) return { status: 400 };

  const headers: Record<string, string> = {
    ...(!parsedCommand.headers
      ? { "Content-Type": "application/json" }
      : parsedCommand.headers),
  };
  if (
    parsedCommand.bearer &&
    !headers.Authorization &&
    !headers.authorization
  ) {
    headers.Authorization = `Bearer ${parsedCommand.bearer}`;
  }

  const body =
    parsedCommand.body !== undefined
      ? typeof parsedCommand.body === "string"
        ? parsedCommand.body
        : JSON.stringify(parsedCommand.body)
      : undefined;

  try {
    const res = await fetch(parsedCommand.url, {
      method: parsedCommand.method || "GET",
      headers,
      body,
    });
    if (res.ok) {
      const text = await res.text();
      console.log(
        `Power request to ${parsedCommand.url} succeeded with response:`,
        text
      );
      return { status: 200 };
    }
    throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    console.error(err);
    return { status: 400 };
  }
}

export function setupSocketHandlers(io: Server): void {
  io.on("connection", (socket) => {
    const uuids: string[] = [];

    console.log("client connected");

    const uuid = socket.handshake.query.uuid as string;
    const token = socket.handshake.query.token as string;

    if (socket.handshake.query?.token) {
      if (!register(token, uuid, socket, uuids)) {
        socket.disconnect(true);
        return;
      }
    }

    socket.on("update", ({ rev, ...msg }: UpdateMessage, callback) => {
      if (!state[uuid]) {
        callback?.({ status: 403 });
        return;
      }
      if (!state[uuid].rev || rev === state[uuid].rev) {
        state[uuid] = {
          ...state[uuid],
          ...msg,
          ...(msg.remaining
            ? {
                endDate: Date.now() + msg.remaining * 1000,
                remaining: msg.remaining,
              }
            : msg.paused && !state[uuid].paused && state[uuid].endDate
              ? {
                  remaining: Math.floor(
                    (state[uuid].endDate! - Date.now()) / 1000
                  ),
                }
              : {}),
          rev: uuidv4(),
        };
        console.log("states is", state[uuid]);
        forward("update", uuid, token, callback, msg as Record<string, unknown>);
      } else {
        callback?.({ status: 409 });
      }
    });

    socket.on("power", ({ turnOn, turnOff, mode }: PowerMessage, callback) => {
      if (state[uuid]) {
        const sanitizedUuid = uuid.replace(/-/g, "_");
        const promises: Promise<{ status: number }>[] = [];

        if (mode) {
          if (mode === "score")
            promises.push(doPowerRequest(`POWER_ON_URL_${sanitizedUuid}`));
          if (mode === "off")
            promises.push(doPowerRequest(`POWER_OFF_URL_${sanitizedUuid}`));
          if (mode === "signage")
            promises.push(doPowerRequest(`SIGNAGE_URL_${sanitizedUuid}`));
        } else {
          if (turnOn)
            promises.push(doPowerRequest(`POWER_ON_URL_${sanitizedUuid}`));
          if (turnOff)
            promises.push(doPowerRequest(`POWER_OFF_URL_${sanitizedUuid}`));
        }

        Promise.all(promises).then((results) => {
          if (!results.length) {
            callback?.({ status: 404 });
            return;
          }
          const ok = results.some((r) => r?.status === 200);
          callback?.({
            status: ok ? 200 : results[0]?.status || 400,
          });
        });
      }
      console.log("states is", state[uuid]);
    });

    socket.on("ping", () => {});

    socket.on("sync", (_data: Record<string, never>, callback) => {
      if (validateToken(token) && state[uuid]) {
        callback?.({
          status: 200,
          resp: {
            ...state[uuid],
            remaining:
              state[uuid].paused && state[uuid].remaining
                ? state[uuid].remaining
                : state[uuid].endDate
                  ? Math.floor((state[uuid].endDate! - Date.now()) / 1000)
                  : undefined,
            endDate: undefined,
          },
        });
      }
    });

    socket.on("disconnect", () => {
      console.log("client disconnected");
      uuids.forEach((id) => {
        scoreBoards[id] = (scoreBoards[id] || []).filter((x) => x !== socket);
      });
    });
  });
}
