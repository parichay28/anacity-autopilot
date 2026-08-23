/*
 * The listener's two outputs: timestamped console lines for a human tailing it,
 * and the append-only JSONL event feed (the analytics log).
 */

import { appendFileSync } from "node:fs";

import { config } from "#src/config.ts";
import { color, out } from "#src/utils/terminal.ts";
import { errorMessage } from "#src/utils/errors.ts";
/* Type-only, so this erases at runtime and creates no cycle with server/. */
import type { TraceRecord, ApprovalRecord } from "#src/server/types.ts";

/* Console lines carry a timestamp — a background log is read hours after the fact. */
export function log(message: string): void {
  out(`${color.dim(new Date().toISOString())} ${message}`);
}

export function logEvent(record: TraceRecord & Partial<ApprovalRecord>): void {
  try {
    appendFileSync(config.logFile, `${JSON.stringify(record)}\n`);
  } catch (error) {
    out(color.red(`log write failed: ${errorMessage(error)}`));
  }
}
