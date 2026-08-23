/*
 * Push key names vary, so id extraction tries several candidate names for each
 * field. Every raw payload is also logged in full, so the first real order
 * reveals the exact keys for good.
 */
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

/*
 * How many push ids to remember for dedupe. The set is rewritten to disk on
 * every push and scanned on every lookup, so an uncapped one makes a
 * long-lived listener pay for every push it has ever seen. Oldest ids fall off
 * first; FCM only ever replays recent undelivered pushes.
 */
export const MAX_REMEMBERED_PUSH_IDS = 2_000;
