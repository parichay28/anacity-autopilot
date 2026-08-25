/* The tracking subsystem: shapes every JSONL event, derives latency figures,
 * and prints the push dump and flow summary. Callers never build records. */

import { log, logEvent } from "#src/logger.ts";
import { color, out } from "#src/utils/terminal.ts";
import type { TraceRecord, ApprovalRecord } from "./types.ts";

/* Re-auth cost summed across an approval's authed calls, for latency attribution. */
export interface ApprovalTiming {
  relogins: number;
  reloginMs: number;
}

export function recordRelogins(
  record: ApprovalRecord,
  timing: ApprovalTiming,
): void {
  if (timing.relogins) {
    record.reloginCount = timing.relogins;
    record.reloginMs = timing.reloginMs;
  }
}

/* Push visit timestamp (community TZ) → decision returned: visitor-facing latency
 * incl. FCM transit. undefined if unparseable; reflects laptop/backend clock skew. */
function computeBackendLatency(
  visitTimestamp: string | undefined,
  respondedMs: number,
): number | undefined {
  if (!visitTimestamp) return undefined;
  const parsed = Date.parse(visitTimestamp.replace(" ", "T"));
  return Number.isNaN(parsed) ? undefined : respondedMs - parsed;
}

/* One-line console trace of the flow; labels the outcome so a failed or rejected
 * decision never reads as a success. */
function flowTrace(record: ApprovalRecord): string {
  const outcome = record.succeeded
    ? "auto-approved"
    : record.acted
      ? `decision FAILED (appCode ${record.response?.appCode ?? "?"})`
      : record.error
        ? "errored"
        : `not acted (${record.skippedReason ?? "?"})`;
  const parts: Array<string> = [];
  if (record.backendToApprovalMs !== undefined)
    parts.push(`backend→approval ${record.backendToApprovalMs}ms`);
  if (record.hostLookupMs !== undefined)
    parts.push(`hostLookup ${record.hostLookupMs}ms`);
  if (record.decisionMs !== undefined)
    parts.push(`decision ${record.decisionMs}ms`);
  if (record.reloginCount)
    parts.push(`relogin ${record.reloginCount}×+${record.reloginMs}ms`);
  return `${outcome} in ${record.latencyMs}ms (${parts.join(", ")})`;
}

/* Full, human-readable dump of the raw push — every key/value. */
export function dumpPush(trace: TraceRecord): void {
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

/* Records an acted-on push: fills in latency from `arrivalMs`, prints the flow
 * summary, and writes the merged trace+outcome event. */
export function logApprovalOutcome(
  trace: TraceRecord,
  record: ApprovalRecord,
  arrivalMs: number,
): void {
  const respondedMs = Date.now();
  record.latencyMs = respondedMs - arrivalMs;
  const backendMs = computeBackendLatency(
    trace.extracted.visitTimestamp,
    respondedMs,
  );
  if (backendMs !== undefined) record.backendToApprovalMs = backendMs;
  log(color.dim(flowTrace(record)));
  logEvent({ ...trace, ...record });
}

/* Records a push we only observed — action=off, or a non-approval push. */
export function logObservedPush(trace: TraceRecord): void {
  out(
    color.dim(
      trace.detected
        ? "action=off — logged, not acting"
        : "non-approval push — logged only",
    ),
  );
  logEvent({ ...trace, acted: false });
}

export function logKeepalive(
  ageMin: number,
  alive: boolean,
  reloginMs: number,
  ok: boolean,
  error?: string,
): void {
  logEvent({
    ts: new Date().toISOString(),
    kind: "keepalive",
    ageMin,
    alive,
    reloginMs,
    ok,
    ...(error ? { error } : {}),
  });
}

export function logSocketUp(downMs?: number): void {
  log(color.dim("socket connected"));
  logEvent({
    ts: new Date().toISOString(),
    kind: "socket",
    state: "up",
    ...(downMs === undefined ? {} : { downMs }),
  });
}

export function logSocketDown(): void {
  log(color.yellow("socket dropped — reconnecting"));
  logEvent({
    ts: new Date().toISOString(),
    kind: "socket",
    state: "down",
  });
}
