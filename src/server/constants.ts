/* Push key names vary, so extraction tries several candidates per field. Raw
 * payloads are logged in full, so the first real order reveals the exact keys. */
export const GATE_PASS_ID_KEYS = [
  "gate_pass_id",
  "gatePassID",
  "gate_pass",
  "gpid",
];
export const HOST_ID_KEYS = ["host_id", "hostID"];
export const VISITOR_NAME_KEYS = [
  "visitor_name",
  "vis_name",
  "visitorName",
  "name",
  "title",
];
export const VISITOR_ORG_KEYS = [
  "visitor_org",
  "org_description",
  "visitorOrg",
  "org",
  "brand",
];
export const NOTIFY_CHOICE_KEYS = ["notify_choice", "notifyChoice"];

export const VISIT_TIMESTAMP_KEYS = [
  "visit_timestamp_comm_tz",
  "visit_timestamp",
];

/* Dedupe cap: the set is rewritten and scanned on every push, so uncapped it
 * grows forever. Oldest fall off first; FCM only replays recent pushes. */
export const MAX_REMEMBERED_PUSH_IDS = 2_000;

/* Relogin cadence (min) to keep a warm session; must stay under the real expiry
 * (an unused session survived >=100 min in testing). 60 is under validation. */
export const SESSION_KEEPALIVE_MIN = 60;
