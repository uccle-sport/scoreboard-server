// Per-display configuration lives in env vars suffixed with the scoreboard UUID,
// hyphens replaced by underscores because `-` is not legal in a shell variable
// name: `TV_URL_0d15b7257_f58f_4d70_a786_e6a530ff7ed7`. The sanitising was
// written inline at every call site; these two helpers are the single version.

export const sanitizeUuid = (uuid: string): string => uuid.replace(/-/g, "_");

// Reads `<prefix>_<sanitized uuid>`. There is deliberately no un-suffixed
// fallback: every lookup in this server is an exact key read, and a fallback
// would let one display's config silently answer for another.
export const envFor = (prefix: string, uuid: string): string | undefined =>
  process.env[`${prefix}_${sanitizeUuid(uuid)}`];
