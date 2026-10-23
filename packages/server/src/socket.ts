import type { Server } from "socket.io";
import type { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import {
  validateToken,
  FLOWR_BEARER,
  FLOWR_LOGO_URL_TEMPLATE,
} from "./config.js";
import { scoreBoards, state, forward, register } from "./state.js";
import { envFor, sanitizeUuid } from "./env-keys.js";
import {
  accessStateFor,
  can,
  canAny,
  claim,
  extend,
  release,
  unlock,
} from "./access.js";
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

// Builds the headers for a Flowr request. The Flowr REST API rejects any body
// whose Content-Type is not `application/json` with `HTTP 400 Content type '…'
// not supported`, and fetch stamps `text/plain;charset=UTF-8` on a string body
// when the header is absent. So the default is *merged under* the config's own
// headers rather than replaced by them — a config that sets only `Accept` must
// still send a Content-Type. The bearer is injected the same way, so a config may
// override either without losing the other.
export function buildFlowrHeaders(
  configHeaders: Record<string, string> | undefined,
  bearer: string | undefined
): Record<string, string> {
  const headers: Record<string, string> = { ...configHeaders };
  const has = (name: string) =>
    Object.keys(headers).some((h) => h.toLowerCase() === name);

  if (!has("content-type")) headers["Content-Type"] = "application/json";
  if (bearer && !has("authorization")) headers.Authorization = `Bearer ${bearer}`;
  return headers;
}

// How much of an upstream error body to keep. Enough for Flowr's one-line
// messages and a truncated stack, short enough not to flood the log.
const MAX_ERROR_BODY = 500;

// Builds the Error message for a failed Flowr response. Flowr answers with a JSON
// body naming the actual problem — "Searching on invisible fields is forbidden",
// "Content type '…' not supported", "Missing discriminator $type in object" —
// while the status alone says only that something was rejected. Carrying the body
// into the error is the difference between a one-line diagnosis and guesswork, so
// never throw the bare status. (`globalThis.Response` because the bare name is
// Express's Response here, imported above for the logo handler.)
export async function httpError(res: globalThis.Response): Promise<Error> {
  let detail = "";
  try {
    detail = (await res.text()).trim().slice(0, MAX_ERROR_BODY);
  } catch {
    // The body was already consumed or the stream broke; the status still stands.
  }
  return new Error(
    detail ? `HTTP ${res.status}: ${detail}` : `HTTP ${res.status}`
  );
}

async function flowrCommand(
  envVarKey: string,
  channel?: string,
  volume?: number
): Promise<{ status: number }> {
  const command = process.env[envVarKey];
  if (!command) return { status: 404 };

  // Fill the template placeholders before parsing: {channel} sits inside quoted
  // JSON strings (the device route), while {volume} is an unquoted numeric slot
  // ("volume":{volume}), so both must be substituted in the raw text — the result
  // is only valid JSON once they are. A missing channel collapses to an empty
  // segment; a missing volume becomes null (matching the power/scoreboard commands).
  const filled = command
    .replace(
      /{channel}/g,
      channel !== undefined ? encodeURIComponent(channel) : ""
    )
    .replace(
      /{volume}/g,
      volume !== undefined ? String(clampVolume(volume)) : "null"
    );

  let parsedCommand: FlowrCommand;
  try {
    parsedCommand = JSON.parse(filled);
  } catch (e) {
    console.error("Invalid JSON for", envVarKey, e);
    return { status: 400 };
  }
  if (!parsedCommand?.url) return { status: 400 };

  // Inject the shared bearer (from .env), falling back to one embedded in the command.
  const headers = buildFlowrHeaders(
    parsedCommand.headers,
    FLOWR_BEARER ?? parsedCommand.bearer
  );

  try {
    const res = await fetch(parsedCommand.url, {
      method: parsedCommand.method || "GET",
      headers,
      body: parsedCommand.body ? JSON.stringify(parsedCommand.body) : undefined,
    });
    if (res.ok) {
      const text = await res.text();
      console.log(
        `Flowr command to ${parsedCommand.url} succeeded with response:`,
        text
      );
      return { status: 200 };
    }
    throw await httpError(res);
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
  // An absent env var is a legitimate "no channels here", but one that is set and
  // unusable is a misconfiguration — most often the bare Flowr search body pasted
  // in without the request wrapper around it. Say so rather than serving an empty
  // picker with a clean log.
  if (!config?.url) {
    console.error(
      `${envVarKey} has no "url" (found: ${Object.keys(config ?? {}).join(", ") || "nothing"}). ` +
        `Expected {"url":"…","method":"POST","channelType":"tv","body":{…}} — ` +
        `the search query goes under "body". No channels loaded.`
    );
    return [];
  }

  const headers = buildFlowrHeaders(config.headers, FLOWR_BEARER);

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
  if (!res.ok) throw await httpError(res);

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

// The keys `update` is allowed to write. ScoreboardState carries an index
// signature, so without this every client-supplied key lands in server state and
// is spread straight back out by `sync` — which would let any phone inject or
// read whatever it liked. This is the exact set the admin app sends.
const UPDATABLE_KEYS = [
  "home",
  "away",
  "remaining",
  "paused",
  "period",
  "homeTeam",
  "awayTeam",
] as const;

function pickUpdatable(msg: Record<string, unknown>): Record<string, unknown> {
  const picked: Record<string, unknown> = {};
  for (const key of UPDATABLE_KEYS) {
    if (msg[key] !== undefined) picked[key] = msg[key];
  }
  return picked;
}

// Pushes each socket its *own* access state. The payload carries the control PIN
// for holders only, so it can never be built once and broadcast — a single
// shared payload would hand the PIN to every read-only phone in the room.
export function broadcastAccess(uuid: string, now = Date.now()): void {
  (scoreBoards[uuid] ?? []).forEach((s) => {
    s.emit(
      "access",
      accessStateFor(uuid, s.data.deviceId as string | undefined, now)
    );
  });
}

export function setupSocketHandlers(io: Server): void {
  io.on("connection", (socket) => {
    const uuids: string[] = [];

    console.log("client connected");

    const uuid = socket.handshake.query.uuid as string;
    const token = socket.handshake.query.token as string;
    // Identifies the phone, not the venue — `uuid` is the scoreboard. Grants are
    // recorded against this so control survives a reload or a dropped
    // connection; Socket.IO resends the handshake query on reconnect. Absent for
    // the big-screen display app, which therefore can never hold a capability.
    const deviceId = (socket.handshake.query.device as string) || undefined;
    socket.data.deviceId = deviceId;

    // Previously a socket with an empty or absent token was neither registered
    // nor disconnected: it stayed connected and could still drive the device
    // webhooks, because those handlers only checked that `state[uuid]` existed.
    if (!register(token, uuid, socket, uuids)) {
      socket.disconnect(true);
      return;
    }

    // Denials carry the current access state so the client can raise its banner
    // straight from the ack instead of waiting for a refresh.
    const deny = (status: number) => ({
      status,
      access: accessStateFor(uuid, deviceId),
    });

    socket.on("update", ({ rev, ...msg }: UpdateMessage, callback) => {
      if (!state[uuid]) {
        callback?.({ status: 403 });
        return;
      }
      // Authorise before touching state. The old order mutated and bumped `rev`
      // first, so a rejected write still invalidated everyone else's rev and
      //409-stormed the legitimate scorer on their next keystroke.
      if (!can(uuid, deviceId, "edit")) {
        callback?.(deny(403));
        return;
      }
      const fields = pickUpdatable(msg as Record<string, unknown>);
      if (!state[uuid].rev || rev === state[uuid].rev) {
        state[uuid] = {
          ...state[uuid],
          ...fields,
          ...(fields.remaining
            ? {
                endDate: Date.now() + (fields.remaining as number) * 1000,
                remaining: fields.remaining as number,
              }
            : fields.paused && !state[uuid].paused && state[uuid].endDate
              ? {
                  remaining: Math.floor(
                    (state[uuid].endDate! - Date.now()) / 1000
                  ),
                }
              : {}),
          rev: uuidv4(),
        };
        console.log("states is", state[uuid]);
        forward("update", uuid, callback, fields);
      } else {
        callback?.({ status: 409 });
      }
    });

    socket.on("power", ({ on }: PowerMessage, callback) => {
      // Blanking the screen is the most disruptive action available and lives on
      // the settings screen, so it takes the score-edit capability. Previously
      // this handler had no authorisation of any kind.
      if (!state[uuid]) {
        callback?.({ status: 403 });
        return;
      }
      if (!can(uuid, deviceId, "edit")) {
        callback?.(deny(403));
        return;
      }
      state[uuid] = { ...state[uuid], power: on ? "on" : "off" };
      flowrCommand(
        `${on ? "POWER_ON_URL" : "POWER_OFF_URL"}_${sanitizeUuid(uuid)}`
      ).then((r) => callback?.({ status: r.status }));
      console.log("states is", state[uuid]);
    });

    socket.on(
      "display",
      ({ display, channel, volume }: DisplayMessage, callback) => {
        if (!state[uuid]) {
          callback?.({ status: 403 });
          return;
        }
        // Switching *to* a source needs that source's PIN. Going back to the
        // scoreboard accepts any grant, so an operator who unlocked only TV is
        // not stranded on TV with no way home.
        const allowed =
          display === "scoreboard"
            ? canAny(uuid, deviceId)
            : can(uuid, deviceId, display === "tv" ? "tv" : "signage");
        if (!allowed) {
          callback?.(deny(403));
          return;
        }
        const vol = volume !== undefined ? clampVolume(volume) : undefined;
        state[uuid] = {
          ...state[uuid],
          display,
          channel,
          ...(vol !== undefined ? { volume: vol } : {}),
        };
        const sanitized = sanitizeUuid(uuid);
        const key =
          display === "scoreboard"
            ? `SCOREBOARD_URL_${sanitized}`
            : display === "tv"
              ? `TV_URL_${sanitized}`
              : `SIGNAGE_URL_${sanitized}`;
        const ch = display === "scoreboard" ? undefined : channel;
        flowrCommand(key, ch, vol).then((r) => callback?.({ status: r.status }));
        console.log("states is", state[uuid]);
      }
    );

    socket.on("volume", ({ volume }: VolumeMessage, callback) => {
      if (!state[uuid]) {
        callback?.({ status: 403 });
        return;
      }
      // Volume belongs to whatever is currently on screen, so it takes that
      // source's capability.
      const current = state[uuid].display;
      const needed =
        current === "tv" ? "tv" : current === "signage" ? "signage" : undefined;
      if (needed ? !can(uuid, deviceId, needed) : !canAny(uuid, deviceId)) {
        callback?.(deny(403));
        return;
      }
      const vol = clampVolume(volume);
      state[uuid] = { ...state[uuid], volume: vol };
      const sanitized = sanitizeUuid(uuid);
      // VOLUME_URL no longer exists: re-issue the current display's force-channel
      // command (tv or signage) for the currently selected channel, now carrying
      // the new volume. Scoreboard has no channel/audio route, so nothing is sent.
      const { display, channel } = state[uuid];
      const key =
        display === "tv"
          ? `TV_URL_${sanitized}`
          : display === "signage"
            ? `SIGNAGE_URL_${sanitized}`
            : undefined;
      if (!key) {
        callback?.({ status: 200 });
        return;
      }
      flowrCommand(key, channel, vol).then((r) =>
        callback?.({ status: r.status })
      );
      console.log("states is", state[uuid]);
    });

    socket.on("ping", () => {});

    socket.on("sync", async (_data: Record<string, never>, callback) => {
      // Reading is authorised by the shared secret alone: the big-screen display
      // polls this every 60s and holds no PIN, and a read-only phone must be
      // able to see the score before it asks for control.
      if (validateToken(token) && state[uuid]) {
        const sanitized = sanitizeUuid(uuid);
        const [tv, signage] = await Promise.all([
          getChannels(`TV_CHANNELS_${sanitized}`),
          getChannels(`SIGNAGE_CHANNELS_${sanitized}`),
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
            access: accessStateFor(uuid, deviceId),
          },
        });
      } else {
        // Previously there was no else: a bad token got no ack at all and the
        // client waited forever, indistinguishable from a slow network.
        callback?.({ status: 401 });
      }
    });

    // --- Access control -----------------------------------------------------
    // `access` is a pure query; the rest are transitions, and each broadcasts
    // afterwards so every phone's banner and read-only state stays in step.

    socket.on("access", (_data: Record<string, never>, callback) => {
      callback?.({ status: 200, access: accessStateFor(uuid, deviceId) });
    });

    socket.on("claim", (_data: Record<string, never>, callback) => {
      const result = claim(uuid, deviceId);
      if (result.status === 200) broadcastAccess(uuid);
      callback?.({ ...result, access: accessStateFor(uuid, deviceId) });
    });

    socket.on("unlock", ({ pin }: { pin?: unknown }, callback) => {
      const result = unlock(uuid, deviceId, pin);
      if (result.status === 200) broadcastAccess(uuid);
      callback?.({ ...result, access: accessStateFor(uuid, deviceId) });
    });

    socket.on("extend", (_data: Record<string, never>, callback) => {
      const result = extend(uuid, deviceId);
      if (result.status === 200) broadcastAccess(uuid);
      callback?.({ ...result, access: accessStateFor(uuid, deviceId) });
    });

    socket.on("release", (_data: Record<string, never>, callback) => {
      const result = release(uuid, deviceId);
      if (result.status === 200) broadcastAccess(uuid);
      callback?.({ ...result, access: accessStateFor(uuid, deviceId) });
    });

    socket.on("disconnect", () => {
      console.log("client disconnected");
      uuids.forEach((id) => {
        scoreBoards[id] = (scoreBoards[id] || []).filter((x) => x !== socket);
      });
    });
  });
}
