import type { Server } from "socket.io";
import type { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import {
  validateToken,
  FLOWR_BEARER,
  FLOWR_LOGO_URL_TEMPLATE,
} from "./config.js";
import { scoreBoards, state, forward, register } from "./state.js";
import type {
  Channel,
  ChannelSource,
  DisplayMessage,
  FlowrChannelSearchResponse,
  FlowrCommand,
  PowerMessage,
  UpdateMessage,
  VolumeMessage,
} from "./types.js";

function clampVolume(volume: number): number {
  return Math.max(0, Math.min(100, Math.round(volume)));
}

async function flowrCommand(
  envVarKey: string,
  channel?: string,
  volume?: number
): Promise<{ status: number }> {
  const command = process.env[envVarKey];
  if (!command) return { status: 404 };

  let parsedCommand: FlowrCommand;
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
  // Inject the shared bearer (from .env), falling back to one embedded in the command.
  const bearer = FLOWR_BEARER ?? parsedCommand.bearer;
  if (bearer && !headers.Authorization && !headers.authorization) {
    headers.Authorization = `Bearer ${bearer}`;
  }

  let body = parsedCommand.body

  // Substitute the {channel} placeholder in the URL and body for tv/signage.
  let url = parsedCommand.url;
  if (channel !== undefined) {
    const encoded = encodeURIComponent(channel);
    url = url.replace(/{channel}/g, encoded);
    if (body?.message?.route) {
      body.message.route = body.message.route.replace(/{channel}/g, encoded);
    }
  }

  // Apply the requested volume (0..100) to the device message.
  if (volume !== undefined && body?.message) {
    body.message.volume = clampVolume(volume);
  }

  try {
    const res = await fetch(url, {
      method: parsedCommand.method || "GET",
      headers,
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const text = await res.text();
      console.log(
        `Flowr command to ${url} succeeded with response:`,
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

// Derives the numeric Flowr view id from a channel `logo` UUID. Flowr serves logos
// at /ozone/view/{viewId}/... where viewId is the decimal value of the UUID's last
// group (e.g. "00000000-046c-7fc4-0000-0000001369b7" -> 1272247).
function logoViewId(logo: string | undefined): number | undefined {
  if (!logo) return undefined;
  const tail = logo.split("-").pop();
  if (!tail) return undefined;
  const viewId = parseInt(tail, 16);
  return Number.isFinite(viewId) ? viewId : undefined;
}

// Proxies a channel logo image through the server so the bearer token can be
// attached (the browser <img> tag can't send Authorization headers, which is why
// the direct Flowr URL 403s). The route only accepts a logo id and rebuilds the
// URL from FLOWR_LOGO_URL_TEMPLATE — never a client-supplied URL — to avoid SSRF.
export async function channelLogoHandler(
  req: Request,
  res: Response
): Promise<void> {
  if (!FLOWR_LOGO_URL_TEMPLATE) {
    res.status(404).end();
    return;
  }
  const viewId = logoViewId(String(req.params.logo));
  if (viewId === undefined) {
    res.status(400).end();
    return;
  }
  const url = FLOWR_LOGO_URL_TEMPLATE.replace(/{logo}/g, String(viewId));
  const headers: Record<string, string> = {};
  if (FLOWR_BEARER) headers.Authorization = `Bearer ${FLOWR_BEARER}`;
  try {
    const upstream = await fetch(url, { headers });
    if (!upstream.ok) {
      res.status(upstream.status).end();
      return;
    }
    const contentType = upstream.headers.get("content-type");
    if (contentType) res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.end(Buffer.from(await upstream.arrayBuffer()));
  } catch (err) {
    console.error("Failed to proxy channel logo", url, err);
    res.status(502).end();
  }
}

// Loads the list of selectable channels by calling the Flowr channel-search API.
// The request config (url, method, headers, body) is stored as a stringified JSON
// ChannelSource in the env var; the bearer is injected from FLOWR_BEARER. The API
// returns `{ results: [{ channelUuid, name, channelType, logo, ... }] }`, which we
// map to our Channel shape (id = channelUuid, label = name). Each channel's
// imageUrl points at the /channel-logo proxy so the bearer is applied when the
// browser loads it. Throws on transient failure (network / HTTP / parse) so the
// cache can retry; returns [] for "no config", a legitimate empty result.
async function loadChannels(envVarKey: string): Promise<Channel[]> {
  const raw = process.env[envVarKey];
  if (!raw) return [];

  let config: ChannelSource;
  try {
    config = JSON.parse(raw);
  } catch (e) {
    console.error("Invalid JSON for", envVarKey, e);
    return [];
  }
  if (!config?.url) return [];

  const headers: Record<string, string> = {
    ...(config.headers ?? { "Content-Type": "application/json" }),
  };
  if (FLOWR_BEARER && !headers.Authorization && !headers.authorization) {
    headers.Authorization = `Bearer ${FLOWR_BEARER}`;
  }

  const body =
    config.body !== undefined
      ? typeof config.body === "string"
        ? config.body
        : JSON.stringify(config.body)
      : undefined;

  const res = await fetch(config.url, {
    method: config.method ?? "POST",
    headers,
    body,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const data = (await res.json()) as FlowrChannelSearchResponse;
  const results = Array.isArray(data.results) ? data.results : [];

  return results
    .filter((c) => !config.channelType || c.channelType === config.channelType)
    .map((c): Channel | undefined => {
      const id = c.channelUuid ?? c.id;
      if (!id || !c.name) return undefined;
      return {
        id,
        label: c.name,
        // Logos are pre-fetched into the admin app's static assets
        // (packages/app/public/channels, served at /admin/channels) and keyed
        // by the logo id, so the browser loads them directly — no bearer proxy
        // and no runtime Flowr request. Regenerate with
        // packages/app/scripts/fetch-channel-logos.mjs.
        imageUrl: c.logo ? `/admin/channels/${c.logo}.png` : undefined,
      };
    })
    .filter((c): c is Channel => c !== undefined);
}

const CHANNEL_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const CHANNEL_LOAD_ATTEMPTS = 3;
const CHANNEL_RETRY_DELAY_MS = 500;

const channelCache = new Map<
  string,
  { promise: Promise<Channel[]>; expiresAt: number }
>();

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Attempts the load several times before giving up. The retry lives *inside* the
// shared promise so every caller awaiting the same in-flight request benefits
// from the retries — rather than the first failure resolving them all to []. Only
// once all attempts are exhausted does it reject.
async function loadChannelsWithRetry(envVarKey: string): Promise<Channel[]> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= CHANNEL_LOAD_ATTEMPTS; attempt++) {
    try {
      return await loadChannels(envVarKey);
    } catch (err) {
      lastErr = err;
      console.error(
        `Failed to load channels for ${envVarKey} (attempt ${attempt}/${CHANNEL_LOAD_ATTEMPTS})`,
        err
      );
      if (attempt < CHANNEL_LOAD_ATTEMPTS) await delay(CHANNEL_RETRY_DELAY_MS);
    }
  }
  throw lastErr;
}

// Returns the channel list for an env var, cached for an hour. The in-flight
// promise is cached directly so closely-spaced calls share a single upstream
// request (and its retries). If every attempt fails, the entry is evicted so a
// later call starts a fresh retry cycle instead of serving a cached failure.
// Callers degrade to [] only after the retries are exhausted, so one source
// failing never fails the others.
function getChannels(envVarKey: string): Promise<Channel[]> {
  const cached = channelCache.get(envVarKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.promise.catch(() => []);
  }

  const promise = loadChannelsWithRetry(envVarKey);
  const entry = { promise, expiresAt: Date.now() + CHANNEL_CACHE_TTL_MS };
  channelCache.set(envVarKey, entry);

  promise.catch(() => {
    // Evict only if still the current entry, so a fresh attempt already in flight stays.
    if (channelCache.get(envVarKey) === entry) channelCache.delete(envVarKey);
  });

  return promise.catch(() => []);
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

    socket.on("power", ({ on }: PowerMessage, callback) => {
      if (!state[uuid]) return;
      state[uuid] = { ...state[uuid], power: on ? "on" : "off" };
      const sanitizedUuid = uuid.replace(/-/g, "_");
      flowrCommand(
        `${on ? "POWER_ON_URL" : "POWER_OFF_URL"}_${sanitizedUuid}`
      ).then((r) => callback?.({ status: r.status }));
      console.log("states is", state[uuid]);
    });

    socket.on(
      "display",
      ({ display, channel, volume }: DisplayMessage, callback) => {
        if (!state[uuid]) return;
        const vol = volume !== undefined ? clampVolume(volume) : undefined;
        state[uuid] = {
          ...state[uuid],
          display,
          channel,
          ...(vol !== undefined ? { volume: vol } : {}),
        };
        const sanitizedUuid = uuid.replace(/-/g, "_");
        const key =
          display === "scoreboard"
            ? `SCOREBOARD_URL_${sanitizedUuid}`
            : display === "tv"
              ? `TV_URL_${sanitizedUuid}`
              : `SIGNAGE_URL_${sanitizedUuid}`;
        const ch = display === "scoreboard" ? undefined : channel;
        flowrCommand(key, ch, vol).then((r) => callback?.({ status: r.status }));
        console.log("states is", state[uuid]);
      }
    );

    socket.on("volume", ({ volume }: VolumeMessage, callback) => {
      if (!state[uuid]) return;
      const vol = clampVolume(volume);
      state[uuid] = { ...state[uuid], volume: vol };
      const sanitizedUuid = uuid.replace(/-/g, "_");
      // Adjust the volume of the currently selected channel.
      flowrCommand(`VOLUME_URL_${sanitizedUuid}`, state[uuid].channel, vol).then(
        (r) => callback?.({ status: r.status })
      );
      console.log("states is", state[uuid]);
    });

    socket.on("ping", () => {});

    socket.on("sync", async (_data: Record<string, never>, callback) => {
      if (validateToken(token) && state[uuid]) {
        const sanitizedUuid = uuid.replace(/-/g, "_");
        const [tv, signage] = await Promise.all([
          getChannels(`TV_CHANNELS_${sanitizedUuid}`),
          getChannels(`SIGNAGE_CHANNELS_${sanitizedUuid}`),
        ]);
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
            channels: { tv, signage },
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
