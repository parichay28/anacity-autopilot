/* A non-Error throw must still read sensibly in a log line or a JSONL record. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/* Like errorMessage but keeps the stack when there is one — a bug report needs
 * the trace; a user-facing usage error uses errorMessage instead. */
export function errorDetail(error: unknown): string {
  return error instanceof Error
    ? (error.stack ?? error.message)
    : String(error);
}
