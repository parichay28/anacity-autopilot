/*
 * How many times a caller re-authenticates and retries after a session-expiry
 * APIError before giving up. Safe for writes too: an expiry means the call
 * never executed, so retrying cannot double-submit.
 */
export const MAX_RELOGIN_RETRIES = 2;
