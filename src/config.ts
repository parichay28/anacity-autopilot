/*
 * Configuration. The ANACITY platform values (base URL, app client, Firebase
 * identity) are fixed constants. Only the user/society-specific values come
 * from the environment — export them in your shell, or set them in whatever
 * supervises `serve`. `serve` in particular needs ANACITY_USERNAME/
 * ANACITY_PASSWORD present, since it re-authenticates unattended when the
 * session cookie expires.
 */

import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/* All on-disk state this project writes lives under one directory, so every
 * related file is found in one place. Created up front because the write
 * helpers assume the directory already exists. */
const dataDir =
  process.env.ANACITY_DATA_DIR || join(homedir(), ".anacity-autopilot");
mkdirSync(dataDir, { recursive: true });

export const config = {
  /* ANACITY platform constants — identical for every society on ANACITY.
   * The REST host is apnacomplex.com (ANACITY is the rebrand; the app and the
   * account database both live on apnacomplex.com — anacity.com is a different
   * tenant and rejects these accounts with "Email does not exist"). */
  baseURL: "https://www.apnacomplex.com",
  appClient: "member_5232",
  lang: "en",
  /* User / society-specific — supplied via the environment. */
  countryCode: process.env.ANACITY_COUNTRY_CODE || "+91",
  ruID: process.env.ANACITY_RU_ID || "",
  toMeet: process.env.ANACITY_TO_MEET || "",
  commID: process.env.ANACITY_COMM_ID || "",
  /* The login identifier — a mobile number or email. */
  username: process.env.ANACITY_USERNAME || "",
  password: process.env.ANACITY_PASSWORD || "",
  sessionFile:
    process.env.ANACITY_SESSION_FILE || join(dataDir, "session.json"),
  fcmCredsFile: process.env.ANACITY_FCM_CREDS_FILE || join(dataDir, "fcm.json"),
  stateFile:
    process.env.ANACITY_STATE_FILE || join(dataDir, "listener-state.json"),
  logFile: process.env.ANACITY_LOG_FILE || join(dataDir, "events.jsonl"),
};

/*
 * Firebase Cloud Messaging identity used to mint our own device token. These
 * are the api-project-190141397243 project / com.apnacomplex app's public client-config values
 * (a Firebase api key is a public client identifier, not a secret) — fixed for
 * the ANACITY platform, so they are constants, not env-driven.
 */
export const firebase = {
  apiKey: "AIzaSyBY1jXquaYe68Za4fM6U5gFCLBD8PA7ntI",
  projectID: "api-project-190141397243",
  senderID: "190141397243",
  appID: "1:190141397243:android:427554946b807ac1",
  packageName: "com.apnacomplex",
  packageCert: "7be6d6bdb7eaf4502d51ea1454fc28e1719cd71c",
};
