import { useCallback, useEffect, useRef, useState } from "react";
import type useSocket from "@/hooks/use-socket";

export type AccessMode = "open" | "temporary" | "protected";

export interface AccessState {
  mode: AccessMode;
  canEdit: boolean;
  canTv: boolean;
  canSignage: boolean;
  owner: boolean;
  claimable: boolean;
  /** Present only while this phone holds control — it is a credential. */
  pin?: string;
  expiresAt?: number;
  ownerCount?: number;
  /** Next protected-slot boundary. A hint for refreshing, not enforcement. */
  nextChange?: number;
}

/** Assume no rights until the server says otherwise. */
const LOCKED: AccessState = {
  mode: "open",
  canEdit: false,
  canTv: false,
  canSignage: false,
  owner: false,
  claimable: false,
};

interface AccessAck {
  status: number;
  access?: AccessState;
  retryAfter?: number;
}

const params = new URLSearchParams(window.location.href.split("?")[1]);

export default function useAccess(socket: ReturnType<typeof useSocket>) {
  const [access, setAccess] = useState<AccessState>(LOCKED);
  // Read inside timers and listeners without making them depend on it.
  const accessRef = useRef(access);
  accessRef.current = access;

  const apply = useCallback((next?: AccessState) => {
    if (next) setAccess(next);
  }, []);

  const refresh = useCallback(() => {
    socket.emit("access", {}, (ack: AccessAck) => apply(ack?.access));
  }, [socket, apply]);

  const send = useCallback(
    (event: string, payload: Record<string, unknown> = {}) =>
      new Promise<AccessAck>((resolve) => {
        socket.emit(event, payload, (ack: AccessAck) => {
          apply(ack?.access);
          resolve(ack ?? { status: 0 });
        });
      }),
    [socket, apply]
  );

  const claim = useCallback(() => send("claim"), [send]);
  const unlock = useCallback((pin: string) => send("unlock", { pin }), [send]);
  const extend = useCallback(() => send("extend"), [send]);
  const release = useCallback(() => send("release"), [send]);

  // The real enforcement. Mobile browsers suspend timers in a backgrounded tab,
  // so a phone can sit showing "unlocked" long after its control lapsed; a
  // rejected mutation always carries the true state back.
  const onDenied = useCallback(
    (ack?: { status?: number; access?: AccessState }) => {
      if (!ack) return false;
      if (ack.status === 403 || ack.status === 423) {
        setAccess(ack.access ?? LOCKED);
        return true;
      }
      return false;
    },
    []
  );

  // Server-pushed transitions: someone else claimed, released, or overrode.
  useEffect(() => {
    const off = socket.on("access", (next) => apply(next as AccessState));
    return off;
  }, [socket, apply]);

  // Re-read after anything that could have moved us out of step while we were
  // not listening.
  useEffect(() => {
    refresh();
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    socket.socket.on("connect", refresh);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      socket.socket.off("connect", refresh);
    };
  }, [socket, refresh]);

  // A convenience so the banner reappears on time in a foreground tab. Not
  // load-bearing: onDenied covers the case where this never fires.
  useEffect(() => {
    const deadlines = [access.expiresAt, access.nextChange].filter(
      (t): t is number => typeof t === "number"
    );
    if (!deadlines.length) return;
    const delay = Math.min(...deadlines) - Date.now();
    if (delay <= 0) return;
    const timer = setTimeout(refresh, Math.min(delay + 250, 2 ** 31 - 1));
    return () => clearTimeout(timer);
  }, [access.expiresAt, access.nextChange, refresh]);

  // A phone arriving from the owner's QR carries the PIN in the URL. Submit it
  // once, then strip it so a reload — or a screenshot of the address bar —
  // does not keep the credential around.
  const autoJoined = useRef(false);
  useEffect(() => {
    if (autoJoined.current) return;
    const pin = params.get("pin");
    if (!pin || !/^\d{8}$/.test(pin)) return;
    autoJoined.current = true;
    unlock(pin).finally(() => {
      const url = new URL(window.location.href);
      url.searchParams.delete("pin");
      window.history.replaceState({}, "", url.toString());
    });
  }, [unlock]);

  return { access, claim, unlock, extend, release, refresh, onDenied };
}
