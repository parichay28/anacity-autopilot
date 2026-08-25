/* The session core: mutable state every stage shares, and the wrapper that
 * retries an authed call across a relogin when the session expires. */

import { APIError } from "#src/http.ts";
import { reloginFromConfig } from "#src/api/auth/auth.ts";
import { MAX_RELOGIN_RETRIES } from "#src/api/constants.ts";
import { color, out } from "#src/utils/terminal.ts";
import type { Session } from "#src/session.ts";
import type { ApprovalTiming } from "./logs.ts";

export interface ServerState {
  session: Session;
  seenPushIds: Set<string>;
}

/* Runs an authed call, retrying on expiry up to MAX_RELOGIN_RETRIES. Safe for
 * the write it wraps: an expiry means the call never executed. */
export async function withSession<Result>(
  state: ServerState,
  call: (session: Session) => Promise<Result>,
  timing?: ApprovalTiming,
): Promise<Result> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await call(state.session);
    } catch (error) {
      if (!(error instanceof APIError) || attempt >= MAX_RELOGIN_RETRIES)
        throw error;
      out(color.yellow("session expired — re-authenticating"));
      const reloginStart = Date.now();
      state.session = await reloginFromConfig();
      if (timing) {
        timing.relogins += 1;
        timing.reloginMs += Date.now() - reloginStart;
      }
    }
  }
}
