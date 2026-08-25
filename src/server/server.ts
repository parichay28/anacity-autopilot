/* The always-on listener: attach our device token, hold the FCM socket open,
 * and react to visitor pushes the moment the backend sends them. */

import { config } from "#src/config.ts";
import { loadSession } from "#src/session.ts";
import { APIError, isOk } from "#src/http.ts";
import { registerGCMUser, deleteGCMID } from "#src/api/device/device.ts";
import { ensureFCMCredentials, connect } from "#src/fcm/fcm.ts";
import { loadCreds } from "#src/fcm/utils.ts";
import type { StoredFCMCredentials } from "#src/fcm/types.ts";
import { log } from "#src/logger.ts";
import { color, out } from "#src/utils/terminal.ts";
import type { ServerOptions } from "./types.ts";
import { loadSeenPushIds, rememberPushId } from "./utils.ts";
import { withSession } from "./state.ts";
import type { ServerState } from "./state.ts";
import { handlePush } from "./approval.ts";
import { startSessionKeepalive } from "./keepalive.ts";
import { logSocketUp, logSocketDown } from "./logs.ts";

/* Starts the listener. Resolves only on fatal setup errors; otherwise runs
 * until the process is stopped. */
export async function start(options: ServerOptions): Promise<void> {
  const state: ServerState = {
    session: options.session,
    seenPushIds: loadSeenPushIds(),
  };

  out(color.dim("minting / loading device token…"));
  const creds: StoredFCMCredentials = await ensureFCMCredentials();

  out(color.dim("attaching token to your account…"));
  const registration = await withSession(state, (session) =>
    registerGCMUser(session, { regID: creds.fcm.token }),
  );
  /* A non-expiry failure (bad token, 500, quota) returns a non-OK appCode —
   * unchecked, we'd say "listening" but never get routed a push. */
  if (!isOk(registration.appCode)) {
    throw new APIError(
      `token registration failed (code ${registration.appCode}): ${registration.appMsg || "unknown reason"}`,
    );
  }

  out(
    `${color.green("listening")} — action=${options.action}` +
      (options.brands.length ? ` brands=[${options.brands.join(", ")}]` : "") +
      `\n${color.dim(`token ${creds.fcm.token.slice(0, 24)}…  logging to ${config.logFile}`)}`,
  );

  /* Never resolves — runs until the process stops. Rejects only if the socket
   * can't be established, which the CLI renders as an error and exits non-zero. */
  startSessionKeepalive(state);

  let socketDownSince: number | undefined;
  return new Promise<void>((_resolve, reject) => {
    connect(creds, {
      persistentIds: [...state.seenPushIds],
      onConnect: () => {
        const downMs =
          socketDownSince === undefined
            ? undefined
            : Date.now() - socketDownSince;
        socketDownSince = undefined;
        logSocketUp(downMs);
      },
      onDisconnect: () => {
        socketDownSince = Date.now();
        logSocketDown();
      },
      onInfo: (message) => log(color.dim(message)),
      onError: reject,
      onPersistentId: (id) => rememberPushId(state.seenPushIds, id),
      onPayload: ({ data, persistentId }) =>
        void handlePush(state, options, data, persistentId),
    });
  });
}

/* Detaches our token (the backout); local creds are kept since they're reusable.
 * `detached` reflects the backend removing it, not just that a token existed. */
export async function stop(): Promise<{
  hadToken: boolean;
  detached: boolean;
}> {
  const token = loadCreds()?.fcm.token;
  const session = loadSession();
  if (!token || !session) return { hadToken: Boolean(token), detached: false };

  const state: ServerState = { session, seenPushIds: new Set() };
  try {
    const result = await withSession(state, (activeSession) =>
      deleteGCMID(activeSession, { regID: token }),
    );
    return { hadToken: true, detached: isOk(result.appCode) };
  } catch {
    /* Expired session with no credentials to relogin, or a server error. The
     * token expires on its own regardless — but say so, don't claim success. */
    return { hadToken: true, detached: false };
  }
}
