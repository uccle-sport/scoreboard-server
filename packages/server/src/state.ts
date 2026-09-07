import type { Socket } from "socket.io";
import type {
  ScoreboardSockets,
  StateMap,
  ForwardResult,
} from "./types.js";
import { validateToken } from "./config.js";

export const scoreBoards: ScoreboardSockets = {};
export const state: StateMap = {};

// Broadcasts a state delta to every client registered for this scoreboard.
//
// No longer checks the token: authorisation is now a per-capability decision the
// calling handler makes *before* it mutates state (see access.ts). Leaving the
// check here would also reject a phone that holds a valid PIN grant but whose
// socket is only observing.
export function forward(
  action: string,
  uuid: string,
  callback: (result: ForwardResult) => void,
  msg?: Record<string, unknown>
): void {
  console.log(
    `Forwarding: ${uuid}, ${action}${msg ? " < " + JSON.stringify(msg) : ""}`
  );
  if (scoreBoards[uuid] && scoreBoards[uuid].length) {
    scoreBoards[uuid].forEach((s) => {
      s.emit(
        action,
        { ts: Date.now(), rev: state[uuid].rev, ...(msg || {}) },
        (response: unknown) => {
          callback({ status: 200, rev: state[uuid].rev, response });
        }
      );
    });
  } else {
    callback({ status: 404 });
  }
}

export function register(
  token: string,
  uuid: string,
  socket: Socket,
  uuids: string[]
): boolean {
  if (validateToken(token)) {
    console.log(`Registering: ${uuid}`);
    scoreBoards[uuid] = (scoreBoards[uuid] || []).concat([socket]);
    if (!state[uuid]) {
      state[uuid] = {};
    }
    uuids.push(uuid);
    return true;
  } else {
    console.log(`Registering: ${uuid} failed due to incorrect token`);
    return false;
  }
}
