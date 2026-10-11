/* The listener's two outputs: timestamped console lines for a human, and the
 * JSONL event feed, which keeps only the newest config.logEventLimit lines. */

import {
  appendFileSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";

import { config } from "#src/config.ts";
import { color, out } from "#src/utils/terminal.ts";
import { errorMessage } from "#src/utils/errors.ts";
/* Type-only, so this erases at runtime and creates no cycle with server/. */
import type { LogRecord } from "#src/server/types.ts";

/* Lines in the log file. Read from disk on the first write, so events left by
 * an earlier run count toward the limit. */
let eventCount: number | undefined;

function readLogLines(): Array<string> {
  try {
    return readFileSync(config.logFile, "utf8")
      .split("\n")
      .filter((line) => line !== "");
  } catch {
    return [];
  }
}

/* Writes through a temp file and a rename, so a crash mid-trim cannot leave
 * the log truncated. */
function trimLog(): void {
  const kept = readLogLines().slice(-config.logEventLimit);
  const tempFile = `${config.logFile}.tmp`;
  writeFileSync(tempFile, `${kept.join("\n")}\n`);
  renameSync(tempFile, config.logFile);
  eventCount = kept.length;
}

/* Console lines carry a timestamp — a background log is read hours after the fact. */
export function log(message: string): void {
  out(`${color.dim(new Date().toISOString())} ${message}`);
}

export function logEvent(record: LogRecord): void {
  try {
    if (eventCount === undefined) eventCount = readLogLines().length;
    appendFileSync(config.logFile, `${JSON.stringify(record)}\n`);
    eventCount += 1;
    /* ponytail: once full, every event rewrites the whole file. Fine at the
     * listener's few events an hour; trim in batches if volume grows. */
    if (eventCount > config.logEventLimit) trimLog();
  } catch (error) {
    out(color.red(`log write failed: ${errorMessage(error)}`));
  }
}
