// A stable id for this phone, so the server can remember which devices hold
// control. The `uuid` URL param identifies the *scoreboard*, not the phone —
// every admin phone at a venue sends the same one — so control needs its own
// identifier. Treated by the server as an opaque bearer token.
//
// Persisted so that reloading the page, or a socket dropping and reconnecting,
// does not cost the scorer their control mid-match.

const KEY = "scoreboard.deviceId";

// Held in memory as well, so an id survives at least the current session even
// when storage is unavailable.
let cached: string | undefined;

function mint(): string {
  // `crypto.randomUUID` exists only in a secure context, and a venue serving
  // this app over plain http://<LAN-IP>/admin/ is not one — so it can genuinely
  // be undefined here.
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    return Array.from(crypto.getRandomValues(new Uint8Array(16)))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}

export function deviceId(): string {
  if (cached) return cached;
  // Safari in private mode throws on access, not just on write.
  try {
    const stored = localStorage.getItem(KEY);
    if (stored) {
      cached = stored;
      return stored;
    }
  } catch {
    // Fall through and mint a session-only id.
  }

  cached = mint();
  try {
    localStorage.setItem(KEY, cached);
  } catch {
    // Storage unavailable: control still works, but is lost on reload.
  }
  return cached;
}
