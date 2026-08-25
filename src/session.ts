/* Session store: the login cookie jar cached to disk (owner-only). The acsession
 * cookie authenticates every later call. */

import { rmSync } from "node:fs";

import { config } from "#src/config.ts";
import { writeSecretJSON, readJSONFile } from "#src/utils/fs.ts";
import { isRecord, asString, toStringRecord } from "#src/utils/guards.ts";

/* Authenticates every call after login; re-issued on each authenticated request. */
export type CookieJar = Record<string, string>;

export interface Session {
  username?: string;
  cookies: CookieJar;
  loggedInAt: string;
  /* Server-shaped; narrowed at the point of use, never trusted blindly. */
  profile: unknown;
}

/* Validates parsed JSON into a real Session (or null), so loadSession returns
 * a typed value with no cast. */
function toSession(value: unknown): Session | null {
  if (!isRecord(value) || !isRecord(value.cookies)) return null;
  return {
    username: asString(value.username),
    cookies: toStringRecord(value.cookies),
    loggedInAt: asString(value.loggedInAt) ?? "",
    profile: value.profile,
  };
}

export function loadSession(): Session | null {
  return toSession(readJSONFile(config.sessionFile));
}

/* The session cookie is a credential, so the file is owner-only. */
export function saveSession(session: Session): void {
  writeSecretJSON(config.sessionFile, session);
}

export function clearSession(): void {
  rmSync(config.sessionFile, { force: true });
}

export function cookieHeader(session: Session): string {
  return Object.entries(session.cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}
