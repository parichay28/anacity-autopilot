import { config } from "#src/config.ts";
import { isOk } from "#src/http.ts";
import { loadSession, saveSession, clearSession } from "#src/session.ts";
import { color, out, emit, fail, ask } from "#src/utils/terminal.ts";
/* Namespaced: this module exports its own `login` CommandSpec. */
import * as authAPI from "#src/api/auth/auth.ts";
import { optString } from "#src/cli/utils.ts";
import type { CommandSpec, OptionSpec } from "#src/cli/types.ts";

const loginOptions: ReadonlyArray<OptionSpec> = [
  {
    name: "username",
    type: "string",
    env: "ANACITY_USERNAME",
    desc: "Login username — mobile number or email",
  },
  {
    name: "password",
    type: "string",
    env: "ANACITY_PASSWORD",
    desc: "Login password",
  },
  {
    name: "comm-id",
    type: "string",
    env: "ANACITY_COMM_ID",
    desc: "Community id, if your account spans societies",
  },
];

export const login: CommandSpec = {
  summary: "Log in and cache the session",
  options: loginOptions,
  async run({ options }) {
    const username =
      optString(options, "username") ??
      (await ask("ANACITY username (mobile or email): "));

    const password =
      optString(options, "password") ??
      (await ask("ANACITY password: ", { hidden: true }));

    if (!username || !password) fail("username and password are required");

    const { unwrapped, cookies } = await authAPI.login({
      username,
      password,
      commID: optString(options, "comm-id") || "",
    });

    if (!isOk(unwrapped.appCode)) {
      fail(
        `login rejected (code ${unwrapped.appCode}): ${unwrapped.appMsg || "unknown reason"}`,
      );
    }
    if (!cookies.acsession)
      fail("login succeeded but no session cookie was set");

    saveSession({
      username,
      cookies,
      loggedInAt: new Date().toISOString(),
      profile: unwrapped.data ?? null,
    });

    out(`${color.green("logged in")} as ${username}`);
    out(color.dim(`session cached at ${config.sessionFile}`));
  },
};

export const logout: CommandSpec = {
  summary: "End the session and remove cached credentials",
  async run() {
    const session = loadSession();
    if (session?.cookies.acsession) {
      try {
        await authAPI.logout(session);
      } catch {
        /* Server-side logout is best-effort; always clear locally. */
      }
    }
    clearSession();
    out(`${color.green("logged out")} — local session cleared`);
  },
};

export const whoami: CommandSpec = {
  summary: "Show the current session and cached profile",
  async run() {
    const session = loadSession();
    if (!session) {
      out(color.dim("not logged in"));
      return;
    }
    out(
      `${color.bold(session.username ?? "(unknown)")} ${color.dim(`(since ${session.loggedInAt})`)}`,
    );
    emit(JSON.stringify(session.profile ?? {}, null, 2));
  },
};
