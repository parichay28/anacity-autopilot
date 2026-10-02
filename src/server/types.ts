/* The listener's vocabulary: what it reacts to and what it records. */

import type { Session } from "#src/session.ts";
import type { PushData } from "#src/fcm/types.ts";

export type ServerAction = "off" | "approve" | "reject";

export interface ServerOptions {
  action: ServerAction;
  brands: ReadonlyArray<string>;
  session: Session;
}

/* The ids a push carries, after trying each key alias. */
export interface ExtractedIDs {
  gatePassID?: string;
  hostID?: string;
  visitorName?: string;
  visitorOrg?: string;
  notifyChoice?: string;
  visitTimestamp?: string;
}

/* One acted-on approval push, recorded stage by stage so a single log entry
 * fully explains itself. */
export interface ApprovalRecord {
  acted: boolean;
  /* appCode 200 — the decision the backend accepted (acted ≠ succeeded). */
  succeeded?: boolean;
  skippedReason?: string;
  hostID?: string;
  hostIDSource?: string;
  hostIDLookupError?: string;
  request?: {
    endpoint: string;
    gate_pass_id: string;
    host_id: string;
    status: string;
  };
  response?: { appCode: string; appMsg: string; data: unknown };
  error?: string;
  /* Latency instrumentation (ms) — present on acted-on pushes. */
  latencyMs?: number;
  backendToApprovalMs?: number;
  hostLookupMs?: number;
  decisionMs?: number;
  reloginCount?: number;
  reloginMs?: number;
}

/* Every push, actioned or not, as it lands — the analytics feed's base record. */
export interface TraceRecord {
  ts: string;
  kind: "trace";
  persistentId?: string;
  detected: boolean;
  extracted: ExtractedIDs;
  action: ServerAction;
  raw: PushData;
}

/* A socket up/down transition — durable so missed-push windows show in the feed. */
interface SocketRecord {
  ts: string;
  kind: "socket";
  state: "up" | "down";
  downMs?: number;
}

/* A keepalive: probe at `ageMin` then relogin. `alive` = probe found the session
 * valid (validates the cadence); `ok` = the relogin itself succeeded. */
interface KeepaliveRecord {
  ts: string;
  kind: "keepalive";
  ageMin: number;
  alive: boolean;
  reloginMs: number;
  ok: boolean;
  error?: string;
}

/* Everything the event feed writes, discriminated on `kind`. An acted-on push is
 * a trace merged with the approval outcome, so that variant carries both. */
export type LogRecord =
  | (TraceRecord & Partial<ApprovalRecord>)
  | SocketRecord
  | KeepaliveRecord;
