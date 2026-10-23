import type { Socket } from "socket.io";

export type DisplaySource = "scoreboard" | "tv" | "signage";

export interface Channel {
  id: string;
  label: string;
  imageUrl?: string;
}

export interface ScoreboardState {
  rev?: string;
  endDate?: number;
  remaining?: number;
  paused?: boolean;
  power?: "on" | "off";
  display?: DisplaySource;
  channel?: string;
  volume?: number; // 0..100
  [key: string]: unknown;
}

export interface FlowrCommand {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  bearer?: string;
  body?: {
    devices: string[],
    message: {
      type: string,
      route: string,
      volume: number | null,
      lang: string
    },
    shouldBeAcknowledged: boolean,
    shouldWakeUpDevice: boolean
  };
}

// Request config (stored as a stringified JSON env var) used to load the list of
// selectable channels from the Flowr channel-search API.
export interface ChannelSource {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  // Only keep results whose channelType matches (e.g. "tv"). Omit to keep all.
  channelType?: string;
}

// Shape of the Flowr channel-search response we rely on.
export interface FlowrChannel {
  id?: string;
  channelUuid?: string;
  name?: string;
  channelType?: string;
  logo?: string;
}

export interface FlowrChannelSearchResponse {
  results?: FlowrChannel[];
}

// A recurring weekly window during which score editing requires this slot's PIN.
// `days` is 0=Monday..6=Sunday; the minute fields are minutes-from-midnight in
// SLOT_TZ. `toMin <= fromMin` means the window spans midnight.
export interface ParsedSlot {
  days: number[];
  fromMin: number;
  toMin: number;
  pin: string;
}

// Which capability a socket is asking to exercise.
export type Capability = "edit" | "tv" | "signage";

// Temporary shared control of a scoreboard, claimed outside protected slots.
// The PIN is handed to the claiming phone so it can pass it to others; every
// holder is released together when `expiresAt` passes.
export interface TempOwnership {
  pin: string;
  claimedAt: number;
  expiresAt: number;
  devices: Set<string>;
}

// Per-scoreboard access state. Deliberately NOT part of ScoreboardState: that
// type has an index signature and `update` spreads client input into it, so a
// PIN living there would be both writable and readable by any phone.
export interface AccessRecord {
  ownership?: TempOwnership;
  // deviceId -> expiry, for grants obtained with a slot / master PIN.
  editGrants: Map<string, number>;
  tv: Map<string, number>;
  signage: Map<string, number>;
  failures: { count: number; until: number };
}

export type AccessMode = "open" | "temporary" | "protected";

// What a single socket is told about its own access. Computed per socket — `pin`
// is present only for a phone that actually holds control.
export interface AccessStateWire {
  mode: AccessMode;
  canEdit: boolean;
  canTv: boolean;
  canSignage: boolean;
  owner: boolean;
  claimable: boolean;
  pin?: string;
  expiresAt?: number;
  ownerCount?: number;
  nextChange?: number;
}

export type ScoreboardSockets = Record<string, Socket[]>;
export type StateMap = Record<string, ScoreboardState>;

export interface UpdateMessage {
  rev?: string;
  remaining?: number;
  paused?: boolean;
  [key: string]: unknown;
}

export interface PowerMessage {
  on: boolean;
}

export interface DisplayMessage {
  display: DisplaySource;
  channel?: string;
  volume?: number; // 0..100, optional volume to apply with the source switch
}

export interface VolumeMessage {
  volume: number; // 0..100
}

export interface ForwardResult {
  status: number;
  rev?: string;
  response?: unknown;
}
