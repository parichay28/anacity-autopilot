/* HTTP layer that speaks the ANACITY REST envelope with the app's identity
 * headers. m_response_data is often a nested JSON string needing a second parse. */

import { config } from "#src/config.ts";
import { cookieHeader, type Session, type CookieJar } from "#src/session.ts";
import { isRecord, asString } from "#src/utils/guards.ts";

export class APIError extends Error {}

/* Node's fetch has no default timeout; without one a half-open connection
 * hangs an approval handler forever. */
const REQUEST_TIMEOUT_MS = 30_000;

/* The ANACITY envelope, flattened. `data` needs narrowing before use. */
export interface Unwrapped {
  systemCode: string;
  appCode: string;
  appMsg: string;
  data: unknown;
}

/* URL-encoded `a:0:{}` — a PHP-serialized empty array ANACITY sends to clear a
 * cookie. Treat it as a delete, never as a value. */
const CLEARED_COOKIE = "a%3A0%3A%7B%7D";

/* Parses Set-Cookie headers into {name: value}, keeping the last real write
 * per name and ignoring cleared/tombstone cookies. */
export function collectCookies(response: Response): CookieJar {
  const jar: CookieJar = {};
  for (const line of response.headers.getSetCookie?.() ?? []) {
    /* Split on the first "=" only — cookie values themselves contain "=". */
    const pair = line.split(";", 1)[0] ?? "";
    const splitAt = pair.indexOf("=");
    if (splitAt === -1) continue;
    const name = pair.slice(0, splitAt).trim();
    const value = pair.slice(splitAt + 1).trim();
    if (value === "" || value === CLEARED_COOKIE) continue;
    jar[name] = value;
  }
  return jar;
}

/* POSTs form-encoded fields; a given session's cookies authenticate the request. */
export async function apiPost(
  path: string,
  fields: Record<string, string> = {},
  { session = null }: { session?: Session | null } = {},
): Promise<{ response: Response; json: unknown }> {
  const headers: Record<string, string> = {
    "X-ACCLIENT": config.appClient,
    "X-LANG-CODE": config.lang,
    "Content-Type": "application/x-www-form-urlencoded",
    Connection: "Keep-Alive",
  };
  if (session) headers.Cookie = cookieHeader(session);

  const response = await fetch(`${config.baseURL}${path}`, {
    method: "POST",
    headers,
    body: new URLSearchParams(fields).toString(),
    redirect: "manual",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await response.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* Non-JSON (redirect/HTML) — json stays null. */
  }
  return { response, json };
}

/* Unwraps the ANACITY envelope into a flat { systemCode, appCode, appMsg, data }. */
export function unwrap(json: unknown): Unwrapped {
  const envelope = isRecord(json) ? json : {};
  const app = isRecord(envelope.m_app_response) ? envelope.m_app_response : {};
  let data: unknown = app.m_response_data;
  if (typeof data === "string" && data.length) {
    try {
      data = JSON.parse(data);
    } catch {
      /* keep the raw string if not JSON */
    }
  }
  return {
    systemCode: String(envelope.m_system_status_code ?? ""),
    appCode: String(app.m_app_status_code ?? ""),
    appMsg: asString(app.m_app_status_msg) ?? "",
    data,
  };
}

export function isOk(appCode: string): boolean {
  return appCode === "200";
}

/* Throws APIError on missing/expired session. The message keyword sniff is gated
 * behind a non-OK code so a false positive can't double-submit a write on retry. */
export function guardSession(unwrapped: Unwrapped): Unwrapped {
  /* System 401 is an unambiguous auth failure even when appCode is 200 (the
   * backend pairs 200 with 401 for a stale session); check before the OK path. */
  if (unwrapped.systemCode === "401") {
    throw new APIError("session expired — run `anacity login` again");
  }
  if (isOk(unwrapped.appCode)) return unwrapped;
  if (
    unwrapped.appCode === "203" ||
    /session|expired|login|authentication/i.test(unwrapped.appMsg)
  ) {
    throw new APIError("session expired — run `anacity login` again");
  }
  return unwrapped;
}
