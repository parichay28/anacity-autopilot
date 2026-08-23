/* Delivery pre-authorization: creating and cancelling intimated passes. */

import { apiPost, unwrap, guardSession, type Unwrapped } from "#src/http.ts";
import type { Session } from "#src/session.ts";
import type {
  IntimateExpectedVisitorsRequest,
  CancelIntimatedPassRequest,
} from "./types.ts";

/* Pre-authorizes one or more expected visitors/deliveries. */
export async function intimateExpectedVisitors(
  session: Session,
  fields: IntimateExpectedVisitorsRequest,
): Promise<Unwrapped> {
  const { json } = await apiPost(
    "/visitor_tracking/m_intimate_multiple_expected_visitors/",
    fields,
    { session },
  );

  return guardSession(unwrap(json));
}

/* Cancels a pre-authorized pass. Identified by guid (not gate_pass_id). */
export async function cancelIntimatedPass(
  session: Session,
  { guid, reason = "" }: CancelIntimatedPassRequest,
): Promise<Unwrapped> {
  const { json } = await apiPost(
    "/visitor_tracking/m_cancel_intimated_visitor_pass/",
    { guid, cancellation_reason: reason },
    { session },
  );

  return guardSession(unwrap(json));
}
