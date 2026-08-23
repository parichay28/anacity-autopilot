import { config } from "#src/config.ts";
import { isOk } from "#src/http.ts";
import { color, out, emit, fail } from "#src/utils/terminal.ts";
import { extractPasses } from "#src/api/visitors/utils.ts";
import { getMyVisitorPasses } from "#src/api/visitors/visitors.ts";
import {
  intimateExpectedVisitors,
  cancelIntimatedPass,
} from "#src/api/deliveries/deliveries.ts";
import { readString } from "#src/utils/guards.ts";
import {
  optString,
  optNumber,
  optBool,
  requireSession,
  describePass,
} from "#src/cli/utils.ts";
import type {
  CommandSpec,
  OptionSpec,
  OptionValue,
  ArgSpec,
} from "#src/cli/types.ts";

const addOptions: ReadonlyArray<OptionSpec> = [
  {
    name: "brand",
    type: "string",
    required: true,
    desc: "Brand/org name (see `anacity brands`)",
  },
  {
    name: "start",
    type: "string",
    required: true,
    desc: "Start date YYYY-MM-DD",
  },
  {
    name: "end",
    type: "string",
    desc: "End date YYYY-MM-DD (defaults to start)",
  },
  {
    name: "window",
    type: "string",
    default: "09:00-21:00",
    desc: "Daily time window HH:MM-HH:MM",
  },
  {
    name: "unit",
    type: "string",
    env: "ANACITY_RU_ID",
    desc: "ru_id (defaults to your profile)",
  },
  { name: "vehicle", type: "string", desc: "Vehicle number, if any" },
  {
    name: "country-code",
    type: "string",
    env: "ANACITY_COUNTRY_CODE",
    desc: `Dialing code (default ${config.countryCode})`,
  },
  {
    name: "dry-run",
    type: "boolean",
    desc: "Print the request; do not send",
  },
];

const listOptions: ReadonlyArray<OptionSpec> = [
  { name: "offset", type: "number", default: 0, desc: "Page offset" },
  { name: "json", type: "boolean", desc: "Emit the raw list as JSON" },
];

const cancelArgs: ReadonlyArray<ArgSpec> = [
  { name: "guid", required: true, desc: "guid from `deliveries list`" },
];

const cancelOptions: ReadonlyArray<OptionSpec> = [
  { name: "reason", type: "string", default: "", desc: "Cancellation reason" },
];

/*
 * Validates the add-command inputs against the session profile and assembles
 * the m_intimate_multiple_expected_visitors form fields.
 */
function buildDeliveryFields(
  options: Record<string, OptionValue | undefined>,
  profile: unknown,
): {
  fields: Record<string, string>;
  brand: string;
  start: string;
  end?: string;
} {
  const window = optString(options, "window") ?? "09:00-21:00";
  const [startTime, endTime] = window.split("-");
  if (!startTime || !endTime) fail("--window must look like 09:00-21:00");

  const ruID =
    optString(options, "unit") || config.ruID || readString(profile, "ru_id");
  if (!ruID)
    fail("could not determine ru_id — pass --unit or set ANACITY_RU_ID");

  const toMeet =
    config.toMeet ||
    readString(profile, "member_name") ||
    readString(profile, "name") ||
    "";

  const brand = optString(options, "brand");
  const start = optString(options, "start");
  if (!brand || !start) fail("--brand and --start are required");
  const end = optString(options, "end");

  const fields: Record<string, string> = {
    vehicle_number_1: optString(options, "vehicle") || "",
    org_description_1: brand,
    to_meet: toMeet,
    visit_date: start,
    /* repeats_on carries the multi-day span; end defaults to start. */
    repeats_on: end || start,
    start_time: startTime,
    end_time: endTime,
    duration_1: "",
    ru_id: ruID,
    visitor_type: "delivery",
    visitor_details_count: "1",
    can_accept_package_1: "1",
    country_code_1: optString(options, "country-code") || config.countryCode,
  };
  return { fields, brand, start, end };
}

export const deliveries: CommandSpec = {
  summary: "Pre-authorize multi-day deliveries by brand",
  subcommands: {
    add: {
      summary: "Pre-authorize a delivery for a brand over a date range",
      options: addOptions,
      async run({ options }) {
        const session = await requireSession();
        const { fields, brand, start, end } = buildDeliveryFields(
          options,
          session.profile,
        );

        if (optBool(options, "dry-run")) {
          out(color.yellow("dry run — not sent:"));
          return emit(JSON.stringify(fields, null, 2));
        }
        const { appCode, appMsg, data } = await intimateExpectedVisitors(
          session,
          fields,
        );
        if (isOk(appCode)) {
          out(
            `${color.green("delivery pre-authorized")} ${brand} ${start}→${end || start}`,
          );
          emit(JSON.stringify(data ?? {}));
        } else {
          fail(`could not pre-authorize (code ${appCode}): ${appMsg}`);
        }
      },
    },
    list: {
      summary: "List your upcoming pre-authorized passes",
      options: listOptions,
      async run({ options }) {
        const session = await requireSession();
        const offset = optNumber(options, "offset") ?? 0;
        const { data } = await getMyVisitorPasses(session, {
          passType: "upcoming",
          upcomingOffset: offset,
        });
        const { passes } = extractPasses(data);

        if (optBool(options, "json")) return emit(JSON.stringify(passes));
        if (!passes.length)
          return out(color.dim("no upcoming pre-authorized passes"));

        for (const pass of passes) out(`  ${describePass(pass)}`);
        out(color.dim(`${passes.length} upcoming pass(es)`));
      },
    },
    cancel: {
      summary: "Cancel a pre-authorized pass by guid",
      args: cancelArgs,
      options: cancelOptions,
      async run({ positionals, options }) {
        const session = await requireSession();
        const guid = positionals.guid;
        if (!guid) fail("missing guid");

        const { appCode, appMsg } = await cancelIntimatedPass(session, {
          guid,
          reason: optString(options, "reason") ?? "",
        });

        if (isOk(appCode)) out(`${color.green("cancelled")} ${guid}`);
        else fail(`cancel failed (code ${appCode}): ${appMsg}`);
      },
    },
  },
};
