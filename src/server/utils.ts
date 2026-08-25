/* Private helpers: extract ids from a push, and the persisted dedupe set. FCM
 * replays recent pushes on reconnect; remembering handled ids stops double-acting. */

import { readFileSync, writeFileSync, existsSync } from "node:fs";

import { config } from "#src/config.ts";
import { color, out } from "#src/utils/terminal.ts";
import { errorMessage } from "#src/utils/errors.ts";
import { isRecord, asArray } from "#src/utils/guards.ts";
import type { PushData } from "#src/fcm/types.ts";
import type { ExtractedIDs } from "./types.ts";
import {
  GATE_PASS_ID_KEYS,
  HOST_ID_KEYS,
  VISITOR_NAME_KEYS,
  VISITOR_ORG_KEYS,
  NOTIFY_CHOICE_KEYS,
  VISIT_TIMESTAMP_KEYS,
  MAX_REMEMBERED_PUSH_IDS,
} from "./constants.ts";

/* ---- push classification ------------------------------------------------- */

function pick(data: PushData, keys: ReadonlyArray<string>): string | undefined {
  for (const key of keys) {
    const value = data[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

export function extractIDs(data: PushData): ExtractedIDs {
  return {
    gatePassID: pick(data, GATE_PASS_ID_KEYS),
    hostID: pick(data, HOST_ID_KEYS),
    visitorName: pick(data, VISITOR_NAME_KEYS),
    visitorOrg: pick(data, VISITOR_ORG_KEYS),
    notifyChoice: pick(data, NOTIFY_CHOICE_KEYS),
    visitTimestamp: pick(data, VISIT_TIMESTAMP_KEYS),
  };
}

/* Only notify_choice=12 (gate arrival) is actionable. Post-decision pushes
 * (check-in 63, confirmation 1003) also carry gate_pass_id — gate them out. */
export function isApprovalPush(data: PushData, ids: ExtractedIDs): boolean {
  if (ids.notifyChoice !== "12") return false;
  const decided = (data.host_status ?? "").toLowerCase();
  if (decided === "approved" || decided === "rejected") return false;
  return Boolean(ids.gatePassID);
}

/* ---- push-id dedupe ------------------------------------------------------ */

/* Reads the persisted dedupe set, keeping only the newest ids the cap allows. */
export function loadSeenPushIds(): Set<string> {
  if (!existsSync(config.stateFile)) return new Set();
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(config.stateFile, "utf8"));
  } catch (error) {
    /* Losing the dedupe set means already-seen pushes can be replayed — worth
     * saying out loud rather than silently starting from empty. */
    out(
      color.yellow(
        `state file unreadable (${errorMessage(error)}) — dedupe starts empty`,
      ),
    );
    return new Set();
  }
  const ids = isRecord(parsed) ? asArray(parsed.persistentIds) : undefined;
  if (!ids) return new Set();
  const strings = ids.filter(
    (entry): entry is string => typeof entry === "string",
  );
  return new Set(strings.slice(-MAX_REMEMBERED_PUSH_IDS));
}

/* Persists the dedupe set, dropping oldest past the cap. Repeat id is a no-op,
 * so we only rewrite on change; compact since only the listener reads it. */
export function rememberPushId(seen: Set<string>, id: string): void {
  if (seen.has(id)) return;
  seen.add(id);
  /* Set iteration is insertion-ordered, so this drops oldest-first. */
  for (const oldest of seen) {
    if (seen.size <= MAX_REMEMBERED_PUSH_IDS) break;
    seen.delete(oldest);
  }
  writeFileSync(config.stateFile, JSON.stringify({ persistentIds: [...seen] }));
}
