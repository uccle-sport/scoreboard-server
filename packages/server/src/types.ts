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
