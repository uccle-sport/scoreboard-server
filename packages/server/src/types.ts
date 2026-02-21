import type { Socket } from "socket.io";

export interface ScoreboardState {
  rev?: string;
  endDate?: number;
  remaining?: number;
  paused?: boolean;
  [key: string]: unknown;
}

export interface PowerCommand {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  bearer?: string;
  body?: unknown;
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
  turnOn?: boolean;
  turnOff?: boolean;
  mode?: "score" | "off" | "signage";
}

export interface ForwardResult {
  status: number;
  rev?: string;
  response?: unknown;
}
