/*
 * The listener's private helpers: classifying a raw FCM push into the ids the
 * listener needs, and the persisted push-id dedupe set. FCM replays recent
 * undelivered pushes on reconnect; remembering the ids we've handled stops us
 * acting twice.
 */

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
  };
}

/*
 * Only the gate-arrival request (notify_choice=12) is an actionable approval
 * request. Post-decision pushes — check-in (63), approved-confirmation (1003) —
 * also carry a gate_pass_id but must never trigger an action, so we gate on the
 * request choice alone and additionally refuse anything already decided.
 */
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

/*
 * Records a push id and persists the set, dropping the oldest ids past the cap.
 * A repeat id is a no-op, so the file is only rewritten when something changed.
 * Compact, not pretty-printed: nothing reads this file but the listener itself.
 */
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
