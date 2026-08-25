/* Re-login+retry attempts after a session-expiry error. Safe for writes:
 * an expiry means the call never ran, so retrying can't double-submit. */
export const MAX_RELOGIN_RETRIES = 2;
