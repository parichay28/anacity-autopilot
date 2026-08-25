/* Visitor endpoints plus the host_id lookup built on the pass lists.
 * Reply decoders live in ./utils.ts. */

import {
  apiPost,
  unwrap,
  guardSession,
  APIError,
  type Unwrapped,
} from "#src/http.ts";
import { errorMessage } from "#src/utils/errors.ts";
import type { Session } from "#src/session.ts";
import type {
  GetMyVisitorPassesRequest,
  RecordApprovalDecisionRequest,
  ResolveHostIDResponse,
} from "./types.ts";
import { extractPasses } from "./utils.ts";

/* The pass lists that carry host_id, in the order worth trying. */
const HOST_ID_PASS_TYPES: ReadonlyArray<string> = ["inside", "upcoming"];

/* ---- read ---------------------------------------------------------------- */

/* Visitors currently at the gate, from the logged-in member's perspective. */
export async function getActiveVisitors(session: Session): Promise<Unwrapped> {
  const { json } = await apiPost(
    "/visitor_tracking/m_member_get_active_visitors",
    {},
    { session },
  );

  return guardSession(unwrap(json));
}

/* One page of visitor passes. pass_type: history | inside | upcoming | packages;
 * offsets page each list. */
export async function getMyVisitorPasses(
  session: Session,
  {
    passType = "history",
    pastOffset = 0,
    upcomingOffset = 0,
    packagesOffset = 0,
  }: GetMyVisitorPassesRequest = {},
): Promise<Unwrapped> {
  const { json } = await apiPost(
    "/visitor_tracking/m_get_my_visitor_passes/",
    {
      pass_type: passType,
      past_pass_offset: String(pastOffset),
      upcoming_pass_offset: String(upcomingOffset),
      packages_pass_offset: String(packagesOffset),
    },
    { session },
  );

  return guardSession(unwrap(json));
}

/* The community's known visitor organizations (brands), grouped by org_type. */
export async function getVisitorOrgs(session: Session): Promise<Unwrapped> {
  const { json } = await apiPost(
    "/visitor_tracking/m_get_visitor_orgs_by_type/",
    {},
    { session },
  );

  return guardSession(unwrap(json));
}

/* ---- write --------------------------------------------------------------- */

/* Records an approve/reject/accept-package decision for a visitor. */
export async function recordApprovalDecision(
  session: Session,
  { gatePassID, hostID, status }: RecordApprovalDecisionRequest,
): Promise<Unwrapped> {
  const { json } = await apiPost(
    "/visitor_tracking/m_record_approval_decision",
    { gate_pass_id: gatePassID, host_id: hostID, status },
    { session },
  );

  return guardSession(unwrap(json));
}

/* ---- host_id resolution -------------------------------------------------- */

/* The gate push and active-visitor list omit host_id, but the pass lists carry
 * it — so match gate_pass_id across them. Shared by approve and the listener. */
export async function resolveHostID(
  session: Session,
  gatePassID: string,
): Promise<ResolveHostIDResponse> {
  let lastError: string | undefined;

  for (const passType of HOST_ID_PASS_TYPES) {
    try {
      const { data } = await getMyVisitorPasses(session, { passType });
      const { passes } = extractPasses(data);

      const match = passes.find(
        (pass) => String(pass.gate_pass_id) === gatePassID,
      );
      if (match?.host_id) return { hostID: match.host_id, source: passType };
    } catch (error) {
      /* Let session expiry bubble up — the caller re-auths and retries;
       * swallowing it would turn a recoverable expiry into a permanent failure. */
      if (error instanceof APIError) throw error;

      /* Anything else: keep going, the other list may still hold the pass. */
      lastError = `${passType}: ${errorMessage(error)}`;
    }
  }

  return { hostID: "", source: "none", error: lastError };
}
