/* MCS message tags (from push-receiver/src/constants.js). */
export const HEARTBEAT_PING_TAG = 0;
export const HEARTBEAT_ACK_TAG = 1;

/* Keepalive cadence. */
export const PING_INTERVAL_MS = 30_000;
export const WATCHDOG_INTERVAL_MS = 15_000;
export const SILENCE_LIMIT_MS = 90_000;

/* Periodic proof-of-life: without it a healthy socket and dead timers look
 * identical in the log, since heartbeats themselves are too noisy to log. */
export const KEEPALIVE_REPORT_MS = 600_000;
