/* The approval reaction: classify a push, resolve host_id, submit the decision,
 * recording each stage. Record shaping lives in logs.ts. */

import {
  resolveHostID,
  recordApprovalDecision,
} from "#src/api/visitors/visitors.ts";
import { isOk } from "#src/http.ts";
import { log } from "#src/logger.ts";
import { color, out } from "#src/utils/terminal.ts";
import { errorMessage, errorDetail } from "#src/utils/errors.ts";
import type { PushData } from "#src/fcm/types.ts";
import { withSession } from "./state.ts";
import type { ServerState } from "./state.ts";
import type {
  ServerOptions,
  ExtractedIDs,
  ApprovalRecord,
  TraceRecord,
} from "./types.ts";
import { extractIDs, isApprovalPush } from "./utils.ts";
import type { ApprovalTiming } from "./logs.ts";
import {
  recordRelogins,
  dumpPush,
  logApprovalOutcome,
  logObservedPush,
} from "./logs.ts";

/* One approval's shared context: the mutable record/timing every stage writes,
 * plus the inputs they read — built once so stages need not re-thread them. */
interface ApprovalCtx {
  state: ServerState;
  options: ServerOptions;
  ids: ExtractedIDs;
  record: ApprovalRecord;
  timing: ApprovalTiming;
}

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
  ctx: ApprovalCtx,
  gatePassID: string,
): Promise<string> {
  const { ids, record, timing } = ctx;
  let hostID = ids.hostID;
  let hostIDSource = "push";
  if (!hostID) {
    out(color.dim("host_id absent from push — resolving from pass lists…"));
    const lookupStart = Date.now();
    const resolved = await withSession(
      ctx.state,
      (session) => resolveHostID(session, gatePassID),
      timing,
    );
    record.hostLookupMs = Date.now() - lookupStart;
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
  ctx: ApprovalCtx,
  gatePassID: string,
  hostID: string,
  label: string,
): Promise<void> {
  const { record, timing } = ctx;
  const status = ctx.options.action === "reject" ? "rejected" : "approved";
  const tint = ctx.options.action === "reject" ? color.yellow : color.green;

  const endpoint = "/visitor_tracking/m_record_approval_decision";
  const body = { gate_pass_id: gatePassID, host_id: hostID, status };

  record.request = { endpoint, ...body };

  out(color.dim(`→ ${endpoint}  ${JSON.stringify(body)}`));

  const decisionStart = Date.now();
  try {
    const result = await withSession(
      ctx.state,
      (session) =>
        recordApprovalDecision(session, { gatePassID, hostID, status }),
      timing,
    );

    record.acted = true;
    record.succeeded = isOk(result.appCode);

    record.response = {
      appCode: result.appCode,
      appMsg: result.appMsg,
      data: result.data,
    };

    out(
      isOk(result.appCode)
        ? `${tint(`auto-${status}`)} ${label}  ${color.dim(`(appCode 200)`)}`
        : `${color.red("decision failed")} ${label} — ${result.appMsg || `code ${result.appCode}`}`,
    );
  } catch (error) {
    record.error = errorMessage(error);
    out(`${color.red("failed")} ${label} — ${errorMessage(error)}`);
  }
  record.decisionMs = Date.now() - decisionStart;
}

/* Acts on one push, returning a record of every stage so an event explains
 * itself: ids used, host_id source, request sent, raw response. */
async function handleApproval(
  state: ServerState,
  options: ServerOptions,
  ids: ExtractedIDs,
): Promise<ApprovalRecord> {
  const who = ids.visitorName || ids.visitorOrg || "(visitor)";
  const label = `${color.bold(who)} ${color.dim(`gate_pass_id=${ids.gatePassID}`)}`;
  const record: ApprovalRecord = { acted: false };
  const timing: ApprovalTiming = { relogins: 0, reloginMs: 0 };
  const ctx: ApprovalCtx = { state, options, ids, record, timing };

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

  const hostID = await resolveDecisionHostID(ctx, gatePassID);
  recordRelogins(record, timing);
  if (!hostID) {
    out(`${color.red("cannot act")} ${label} — could not determine host_id`);
    record.skippedReason = "could not determine host_id";
    return record;
  }

  await submitDecision(ctx, gatePassID, hostID, label);
  recordRelogins(record, timing);
  return record;
}

/* Classifies one incoming push, acts if configured to, and logs the event. */
export async function handlePush(
  state: ServerState,
  options: ServerOptions,
  data: PushData,
  persistentId: string | undefined,
): Promise<void> {
  const arrivalMs = Date.now();
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
    logApprovalOutcome(trace, outcome, arrivalMs);
  } else {
    logObservedPush(trace);
  }
}
