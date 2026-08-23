/*
 * `serve` — the always-on FCM listener. Registers our own device token against
 * the account and reacts to visitor-approval pushes as they arrive.
 */

import { color, out, fail } from "#src/utils/terminal.ts";
import * as server from "#src/server/server.ts";
import { optString, optBool, requireSession } from "#src/cli/utils.ts";
import type { CommandSpec, OptionSpec } from "#src/cli/types.ts";
import type { ServerAction } from "#src/server/types.ts";

const serveOptions: ReadonlyArray<OptionSpec> = [
  {
    name: "action",
    type: "string",
    default: "off",
    desc: "off | approve | reject — what to do on a visitor push (default off = observe/log only)",
  },
  {
    name: "brands",
    type: "string",
    desc: "Comma-separated brand filter; only act when visitor_org matches",
  },
  {
    name: "stop",
    type: "boolean",
    desc: "Detach our token from the account and exit (the backout)",
  },
];

/* Local guard so the parsed --action string narrows to ServerAction without a cast. */
function isServerAction(value: string): value is ServerAction {
  return value === "off" || value === "approve" || value === "reject";
}

export const serve: CommandSpec = {
  summary: "Run the always-on FCM listener that auto-approves visitor pushes",
  options: serveOptions,
  async run({ options }) {
    if (optBool(options, "stop")) {
      const { hadToken, detached } = await server.stop();
      if (!hadToken) out(color.dim("no token was registered"));
      else if (detached)
        out(`${color.green("detached")} — token removed from your account`);
      else
        out(
          color.yellow(
            "could not detach — token may still be attached; it expires on its own",
          ),
        );
      return;
    }

    const action = (optString(options, "action") ?? "off").toLowerCase();
    if (!isServerAction(action))
      fail("--action must be one of: off, approve, reject");
    const brands = (optString(options, "brands") ?? "")
      .split(",")
      .map((brand) => brand.trim())
      .filter(Boolean);

    /* Same rule as every command: use the cached session, else log in from
     * ANACITY_USERNAME/PASSWORD — which the unattended listener needs anyway. */
    const session = await requireSession();

    process.on("SIGINT", () => {
      out(
        color.dim(
          "\nstopping (token stays attached — use `anacity serve --stop` to detach)",
        ),
      );
      process.exit(0);
    });

    await server.start({ action, brands, session });
  },
};
