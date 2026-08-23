/* Attaching / detaching our FCM device token on the account, so the backend
 * fans this account's pushes out to the listener. */

import { apiPost, unwrap, guardSession, type Unwrapped } from "#src/http.ts";
import type { Session } from "#src/session.ts";
import type { RegisterGCMUserRequest, DeleteGCMIDRequest } from "./types.ts";

/*
 * Registers a device push token against the logged-in account, so the backend
 * delivers this account's notifications to it. reg_id is the FCM token.
 */
export async function registerGCMUser(
  session: Session,
  { regID }: RegisterGCMUserRequest,
): Promise<Unwrapped> {
  const { json } = await apiPost(
    "/community/m_add_gcm_user/",
    {
      reg_id: regID,
      /* Spoofed Android device identity — the backend expects a real phone. */
      model_brand: "Google",
      model_name: "Pixel 8",
      model_version: "14",
      moengage_registered: "0",
    },
    { session },
  );
  return guardSession(unwrap(json));
}

/* Detaches a previously registered push token from the account. */
export async function deleteGCMID(
  session: Session,
  { regID }: DeleteGCMIDRequest,
): Promise<Unwrapped> {
  const { json } = await apiPost(
    "/auth/m_delete_gcm_id",
    { gcm_reg_id: regID },
    { session },
  );
  return guardSession(unwrap(json));
}
