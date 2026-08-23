import type { Unwrapped } from "#src/http.ts";
import type { CookieJar } from "#src/session.ts";

export interface LoginRequest {
  username: string;
  password: string;
  commID?: string;
}

export interface LoginResponse {
  unwrapped: Unwrapped;
  /* The acsession cookie in here authenticates subsequent calls. */
  cookies: CookieJar;
}
