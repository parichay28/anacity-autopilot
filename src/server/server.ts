/*
 * The always-on listener. It registers our own device token against the
 * account, holds the FCM socket open, and reacts to visitor-approval pushes
 * the instant the backend sends them — the same data the phone receives, with
 * no phone in the loop.
 *
 * Every push is appended to a JSONL log (the analytics feed). Whether it acts
 * on visitor pushes is controlled by `action`: "off" observes and logs only;
 * "approve"/"reject" record that decision using the ids carried in the push.
 */

import { config } from "#src/config.ts";
import { loadSession } from "#src/session.ts";
import { APIError, isOk } from "#src/http.ts";
import { reloginFromConfig } from "#src/api/auth/auth.ts";
import { registerGCMUser, deleteGCMID } from "#src/api/device/device.ts";
import {
  resolveHostID,
  recordApprovalDecision,
} from "#src/api/visitors/visitors.ts";
import { MAX_RELOGIN_RETRIES } from "#src/api/constants.ts";
import { ensureFCMCredentials, connect } from "#src/fcm/fcm.ts";
import { loadCreds } from "#src/fcm/utils.ts";
import type { StoredFCMCredentials } from "#src/fcm/types.ts";
import { log, logEvent } from "#src/logger.ts";
import { color, out } from "#src/utils/terminal.ts";
import { errorMessage, errorDetail } from "#src/utils/errors.ts";
import type { Session } from "#src/session.ts";
import type { PushData } from "#src/fcm/types.ts";
import type {
  ServerOptions,
  ExtractedIDs,
  ApprovalRecord,
  TraceRecord,
} from "./types.ts";
import {
  extractIDs,
  isApprovalPush,
  loadSeenPushIds,
  rememberPushId,
} from "./utils.ts";

interface ServerState {
  session: Session;
  seenPushIds: Set<string>;
}

/*
 * Runs an authenticated call, re-logging-in and retrying on expiry up to
 * MAX_RELOGIN_RETRIES times. Safe for the write it wraps: an expiry means the
 * call never executed.
 */
async function withSession<Result>(
  state: ServerState,
  call: (session: Session) => Promise<Result>,
): Promise<Result> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await call(state.session);
    } catch (error) {
      if (!(error instanceof APIError) || attempt >= MAX_RELOGIN_RETRIES)
        throw error;
      out(color.yellow("session expired — re-authenticating"));
      state.session = await reloginFromConfig();
    }
  }
}

/* ---- the approval reaction, stage by stage ------------------------------- */

/* The reason this push is not acted on, or undefined to proceed. */
function brandFilterSkip(
  options: ServerOptions,
  ids: ExtractedIDs,
  label: string,
): string | undefined {
  if (!options.brands.length) return undefined;
  const org = String(ids.visitorOrg || "").toLowerCase();
  const wanted = options.brands.some((brand) =>
    org.includes(brand.toLowerCase()),
  );
  if (wanted) return undefined;
  out(
    `${color.dim("skipped")} ${label} ${color.dim(`(brand "${ids.visitorOrg}" not in filter)`)}`,
  );
  return `brand "${ids.visitorOrg}" not in filter [${options.brands.join(", ")}]`;
}

/* host_id: from the push if present, otherwise looked up from the pass lists. */
async function resolveDecisionHostID(
  state: ServerState,
  ids: ExtractedIDs,
  gatePassID: string,
  record: ApprovalRecord,
): Promise<string> {
  let hostID = ids.hostID;
  let hostIDSource = "push";
  if (!hostID) {
    out(color.dim("host_id absent from push — resolving from pass lists…"));
    const resolved = await withSession(state, (session) =>
      resolveHostID(session, gatePassID),
    );
    hostID = resolved.hostID;
    hostIDSource = resolved.source;
    if (resolved.error) {
      record.hostIDLookupError = resolved.error;
      out(color.yellow(`host_id lookup error — ${resolved.error}`));
    }
  }
  record.hostID = hostID;
  record.hostIDSource = hostIDSource;
  out(color.dim(`host_id=${hostID || "(none)"} source=${hostIDSource}`));
  return hostID ?? "";
}

/* Sends the decision and records the request + raw response on `record`. */
async function submitDecision(
  state: ServerState,
  options: ServerOptions,
  gatePassID: string,
  hostID: string,
  label: string,
  record: ApprovalRecord,
): Promise<void> {
  const status = options.action === "reject" ? "rejected" : "approved";
  const tint = options.action === "reject" ? color.yellow : color.green;

  const endpoint = "/visitor_tracking/m_record_approval_decision";
  const body = { gate_pass_id: gatePassID, host_id: hostID, status };

  record.request = { endpoint, ...body };

  out(color.dim(`→ ${endpoint}  ${JSON.stringify(body)}`));

  try {
    const result = await withSession(state, (session) =>
      recordApprovalDecision(session, { gatePassID, hostID, status }),
    );

    record.acted = true;

    record.response = {
      appCode: result.appCode,
      appMsg: result.appMsg,
      data: result.data,
    };

    out(
      result.appCode === "200"
        ? `${tint(`auto-${status}`)} ${label}  ${color.dim(`(appCode 200)`)}`
        : `${color.red("decision failed")} ${label} — ${result.appMsg || `code ${result.appCode}`}`,
    );
  } catch (error) {
    record.error = errorMessage(error);
    out(`${color.red("failed")} ${label} — ${errorMessage(error)}`);
  }
}

/*
 * Acts on one approval push and returns a structured record of every stage so
 * a single event fully explains itself: the ids used, where host_id came from,
 * the exact request sent, and the raw API response.
 */
async function handleApproval(
  state: ServerState,
  options: ServerOptions,
  ids: ExtractedIDs,
): Promise<ApprovalRecord> {
  const who = ids.visitorName || ids.visitorOrg || "(visitor)";
  const label = `${color.bold(who)} ${color.dim(`gate_pass_id=${ids.gatePassID}`)}`;
  const record: ApprovalRecord = { acted: false };

  const skipped = brandFilterSkip(options, ids, label);
  if (skipped) {
    record.skippedReason = skipped;
    return record;
  }

  if (!ids.gatePassID) {
    out(`${color.red("cannot act")} — no gate_pass_id in push`);
    record.skippedReason = "no gate_pass_id in push";
    return record;
  }
  const gatePassID = ids.gatePassID;

  const hostID = await resolveDecisionHostID(state, ids, gatePassID, record);
  if (!hostID) {
    out(`${color.red("cannot act")} ${label} — could not determine host_id`);
    record.skippedReason = "could not determine host_id";
    return record;
  }

  await submitDecision(state, options, gatePassID, hostID, label, record);
  return record;
}

/* ---- the push loop ------------------------------------------------------- */

/* Full, human-readable dump of the raw push — every key/value. */
function dumpPush(trace: TraceRecord): void {
  out(color.cyan(`\n── push @ ${trace.ts} ──`));
  out(
    color.dim(
      `persistentId=${trace.persistentId}  keys: ${Object.keys(trace.raw).join(", ") || "(none)"}`,
    ),
  );

  for (const [key, value] of Object.entries(trace.raw)) {
    out(`  ${color.dim(key)} = ${String(value).slice(0, 300)}`);
  }

  out(`${color.dim("extracted:")} ${JSON.stringify(trace.extracted)}`);
  out(
    `${color.dim("approval push?")} ${trace.detected}  ${color.dim(`action=${trace.action}`)}`,
  );
}

/* Classifies one incoming push, acts if configured to, and logs the event. */
async function handlePush(
  state: ServerState,
  options: ServerOptions,
  data: PushData,
  persistentId: string | undefined,
): Promise<void> {
  const ids = extractIDs(data);
  const trace: TraceRecord = {
    ts: new Date().toISOString(),
    kind: "trace",
    persistentId,
    detected: isApprovalPush(data, ids),
    extracted: ids,
    action: options.action,
    raw: data,
  };
  dumpPush(trace);

  if (trace.detected && options.action !== "off") {
    /* The trace must survive a throw: its persistentId is already in the
     * dedupe set, so an unlogged failure loses the push for good. */
    let outcome: ApprovalRecord;
    try {
      outcome = await handleApproval(state, options, ids);
    } catch (error) {
      outcome = { acted: false, error: errorDetail(error) };
      log(`${color.red("approval handler threw")} — ${errorMessage(error)}`);
    }
    logEvent({ ...trace, ...outcome });
  } else {
    out(
      color.dim(
        trace.detected
          ? "action=off — logged, not acting"
          : "non-approval push — logged only",
      ),
    );
    logEvent({ ...trace, acted: false });
  }
}

/* ---- lifecycle ----------------------------------------------------------- */

/*
 * Starts the listener. Resolves only on fatal setup errors; otherwise runs until
 * the process is stopped.
 */
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
  /* A non-expiry failure here (rejected token, 500, quota) returns normally with
   * a non-OK appCode. Left unchecked, the listener would report "listening" and
   * then receive nothing forever — the backend never routes to an unattached token. */
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

  /*
   * Never resolves: the listener runs until the process is stopped. It rejects
   * only when the push socket cannot be established at all, which the CLI
   * entry point renders as an error and exits non-zero on.
   */
  return new Promise<void>((_resolve, reject) => {
    connect(creds, {
      persistentIds: [...state.seenPushIds],
      onConnect: () => log(color.dim("socket connected")),
      onDisconnect: () => log(color.yellow("socket dropped — reconnecting")),
      onInfo: (message) => log(color.dim(message)),
      onError: reject,
      onPersistentId: (id) => rememberPushId(state.seenPushIds, id),
      onPayload: ({ data, persistentId }) =>
        void handlePush(state, options, data, persistentId),
    });
  });
}

/*
 * Detaches our token from the account (the backout). The local device
 * credentials are kept: they are reusable, and re-registering on the next
 * `serve` would mint a token for nothing.
 *
 * Reports honestly: `detached` reflects the backend actually removing the
 * token, not merely that a local token existed. Uses the same relogin retry as
 * every other write, since an always-on tool's cached session is often expired.
 */
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
