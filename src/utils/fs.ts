/* Writing the files that hold our credentials — the session cookie and the
 * FCM device credentials. */

import { writeFileSync, chmodSync, readFileSync } from "node:fs";

/* Writes owner-only JSON. `mode` applies only on create, so chmod too —
 * else a rewrite of a loosely-created file leaks the credential. */
export function writeSecretJSON(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value, null, 2), { mode: 0o600 });
  chmodSync(path, 0o600);
}

/* Reads and parses a JSON file, treating absent, unreadable, and malformed
 * alike as "no value". Callers narrow the result with the guards. */
export function readJSONFile(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}
