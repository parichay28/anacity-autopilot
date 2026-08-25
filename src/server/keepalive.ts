/* Keepalive: relogin on a cadence to keep a warm session so a push skips the
 * ~700ms relogin. Pure optimisation — withSession still relogins on expiry. */

import { APIError } from "#src/http.ts";
import { reloginFromConfig } from "#src/api/auth/auth.ts";
import { getActiveVisitors } from "#src/api/visitors/visitors.ts";
import { log } from "#src/logger.ts";
import { color } from "#src/utils/terminal.ts";
import { errorMessage } from "#src/utils/errors.ts";
import { SESSION_KEEPALIVE_MIN } from "./constants.ts";
import { logKeepalive } from "./logs.ts";
import type { ServerState } from "./state.ts";

/* Probe the unused session at its oldest age (what a just-in-time push would hit),
 * then relogin. Relogin failure leaves the old session for withSession to retry. */
async function reloginKeepalive(state: ServerState): Promise<void> {
  const startedMs = Date.now();
  const loginMs = Date.parse(state.session.loggedInAt);
  const ageMin = Number.isNaN(loginMs)
    ? -1
    : Math.round((startedMs - loginMs) / 60_000);
  /* alive=false only on an auth failure; a network error yields no verdict. */
  let alive = true;
  try {
    await getActiveVisitors(state.session);
  } catch (caught) {
    if (caught instanceof APIError) alive = false;
  }
  try {
    state.session = await reloginFromConfig();
    logKeepalive(ageMin, alive, Date.now() - startedMs, true);
  } catch (caught) {
    const error = errorMessage(caught);
    log(color.yellow(`keepalive relogin failed — ${error}`));
    logKeepalive(ageMin, alive, Date.now() - startedMs, false, error);
  }
}

/* First relogin when the session reaches cadence age, then every cadence; the next
 * timer is chained after each relogin so runs never overlap. */
export function startSessionKeepalive(state: ServerState): void {
  const loop = async (): Promise<void> => {
    await reloginKeepalive(state);
    setTimeout(() => void loop(), SESSION_KEEPALIVE_MIN * 60_000);
  };
  const loginMs = Date.parse(state.session.loggedInAt);
  const ageMin = Number.isNaN(loginMs)
    ? SESSION_KEEPALIVE_MIN
    : (Date.now() - loginMs) / 60_000;
  const firstDelayMs = Math.max(0, SESSION_KEEPALIVE_MIN - ageMin) * 60_000;
  setTimeout(() => void loop(), firstDelayMs);
}
