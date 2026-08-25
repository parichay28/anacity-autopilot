/* Login, logout, and the silent re-login that keeps sessions durable. */

import {
  apiPost,
  unwrap,
  collectCookies,
  isOk,
  APIError,
  type Unwrapped,
} from "#src/http.ts";
import { config } from "#src/config.ts";
import { saveSession, type Session } from "#src/session.ts";
import type { LoginRequest, LoginResponse } from "./types.ts";

/* Logs in with email (or mobile) + password. */
export async function login({
  username,
  password,
  commID = config.commID,
}: LoginRequest): Promise<LoginResponse> {
  const { response, json } = await apiPost("/auth/m_login/", {
    /* `email` is the server's form-field name; it also accepts a mobile number. */
    email: username,
    password,
    captcha: "",
    comm_id: commID || "",
  });
  return { unwrapped: unwrap(json), cookies: collectCookies(response) };
}

export async function logout(session: Session): Promise<Unwrapped> {
  const { json } = await apiPost("/auth/m_logout/", {}, { session });
  return unwrap(json);
}

/* Silently refreshes an expired session from configured creds. Throws if
 * creds are missing (nothing to refresh with) or login is rejected. */
export async function reloginFromConfig(): Promise<Session> {
  if (!config.username || !config.password) {
    throw new APIError(
      "session expired and no ANACITY_USERNAME/ANACITY_PASSWORD to refresh it",
    );
  }
  const { unwrapped, cookies } = await login({
    username: config.username,
    password: config.password,
  });
  if (!isOk(unwrapped.appCode) || !cookies.acsession) {
    throw new APIError(
      `re-login failed (code ${unwrapped.appCode}): ${unwrapped.appMsg || "unknown reason"}`,
    );
  }
  const session: Session = {
    username: config.username,
    cookies,
    loggedInAt: new Date().toISOString(),
    profile: unwrapped.data ?? null,
  };
  saveSession(session);
  return session;
}
