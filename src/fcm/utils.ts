/* Readers for the FCM side's loose data: the stored credentials file and the
 * raw push payload. */

import { config } from "#src/config.ts";
import { readJSONFile } from "#src/utils/fs.ts";
import { isRecord, asString, asArray } from "#src/utils/guards.ts";
import type { PushData, StoredFCMCredentials } from "./types.ts";

/* Reads stored credentials, or null if unusable (absent, unreadable, or missing
 * a required field) — the caller responds by registering fresh ones. */
export function loadCreds(): StoredFCMCredentials | null {
  const parsed = readJSONFile(config.fcmCredsFile);
  if (!isRecord(parsed) || !isRecord(parsed.gcm) || !isRecord(parsed.fcm))
    return null;

  const androidId = asString(parsed.gcm.androidId);
  const securityToken = asString(parsed.gcm.securityToken);
  const token = asString(parsed.fcm.token);
  if (!androidId || !securityToken || !token) return null;

  return {
    gcm: { androidId, securityToken },
    fcm: { token },
    registeredAt: asString(parsed.registeredAt) ?? "",
  };
}

/* Normalises push-receiver's app_data (array of {key,value} or object) to a map. */
export function toDataMap(appData: unknown): PushData {
  const map: PushData = {};

  const list = asArray(appData);
  if (list) {
    for (const pair of list) {
      if (isRecord(pair) && typeof pair.key === "string") {
        map[pair.key] =
          pair.value === undefined || pair.value === null
            ? ""
            : String(pair.value);
      }
    }
    return map;
  }

  if (isRecord(appData)) {
    for (const [key, value] of Object.entries(appData))
      map[key] = String(value);
  }
  return map;
}
