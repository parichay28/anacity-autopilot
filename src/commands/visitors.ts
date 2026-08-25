import { isOk } from "#src/http.ts";
import {
  resolveHostID,
  getActiveVisitors,
  getMyVisitorPasses,
  recordApprovalDecision,
} from "#src/api/visitors/visitors.ts";
import { extractPasses } from "#src/api/visitors/utils.ts";
import { color, out, fail } from "#src/utils/terminal.ts";
import { isRecord, asArray, readStrings } from "#src/utils/guards.ts";
import {
  optString,
  optNumber,
  optBool,
  requireSession,
  describeVisitor,
  describePass,
  renderList,
} from "#src/cli/utils.ts";
import type { ArgSpec, CommandSpec, OptionSpec } from "#src/cli/types.ts";
import type { Visitor } from "#src/api/visitors/types.ts";

const hostOption: OptionSpec = {
  name: "host",
  type: "string",
  env: "ANACITY_HOST_ID",
  desc: "host_id (looked up from your passes if omitted)",
};

const listOptions: ReadonlyArray<OptionSpec> = [
  { name: "json", type: "boolean", desc: "Emit the raw list as JSON" },
];

const passesOptions: ReadonlyArray<OptionSpec> = [
  {
    name: "type",
    type: "string",
    default: "history",
    desc: "history | inside | upcoming | packages",
  },
  {
    name: "offset",
    type: "number",
    default: 0,
    desc: "Page offset for the chosen type",
  },
  { name: "json", type: "boolean", desc: "Emit the raw pass list as JSON" },
];

const packagesOptions: ReadonlyArray<OptionSpec> = [
  { name: "offset", type: "number", default: 0, desc: "Page offset" },
  { name: "json", type: "boolean", desc: "Emit the raw list as JSON" },
];

const gatePassArgs: ReadonlyArray<ArgSpec> = [
  {
    name: "gate_pass_id",
    required: true,
    desc: "Gate pass id from `visitors list`",
  },
];

function readActiveVisitors(data: unknown): ReadonlyArray<unknown> {
  if (isRecord(data)) {
    const listed = asArray(data.visitors) ?? asArray(data.visitors_list);
    if (listed) return listed;
  }
  return asArray(data) ?? [];
}

const toVisitor = (value: unknown): Visitor =>
  readStrings(value, [
    "vis_name",
    "visitor_name",
    "gate_pass_id",
    "ru_num",
    "ru_id",
    "flat",
  ]);

function offsetParamFor(
  passType: string,
  offset: number,
): { pastOffset?: number; upcomingOffset?: number; packagesOffset?: number } {
  if (passType === "upcoming") return { upcomingOffset: offset };
  if (passType === "packages") return { packagesOffset: offset };
  return { pastOffset: offset };
}

function offsetKeyFor(passType: string): string {
  if (passType === "upcoming") return "upcoming_pass_offset";
  if (passType === "packages") return "packages_pass_offset";
  return "past_pass_offset";
}

/* approve / reject / accept differ only in the wire status, the label, and the tint. */
function decisionCommand({
  summary,
  status,
  label,
  tint,
}: {
  summary: string;
  status: string;
  label: string;
  tint(text: string): string;
}): CommandSpec {
  return {
    summary,
    args: gatePassArgs,
    options: [hostOption],
    async run({ positionals, options }) {
      const session = await requireSession();
      const gatePassID = positionals.gate_pass_id;
      if (!gatePassID) fail("missing gate_pass_id");

      /* An explicit --host / ANACITY_HOST_ID override skips the lookup entirely. */
      const hostID =
        optString(options, "host") ||
        (await resolveHostID(session, gatePassID)).hostID;
      if (!hostID) {
        fail(
          `could not determine host_id for gate_pass_id=${gatePassID} — ` +
            "pass --host <id> or set ANACITY_HOST_ID",
        );
      }

      const { appCode, appMsg } = await recordApprovalDecision(session, {
        gatePassID,
        hostID,
        status,
      });

      if (isOk(appCode)) out(`${tint(label)} ${gatePassID}`);
      else
        fail(
          `${label} failed (code ${appCode}): ${appMsg || "unknown reason"}`,
        );
    },
  };
}

export const visitors: CommandSpec = {
  summary: "List and act on gate visitors and passes",
  subcommands: {
    list: {
      summary: "List visitors currently at the gate",
      options: listOptions,
      async run({ options }) {
        const session = await requireSession();
        const { data } = await getActiveVisitors(session);
        const list = readActiveVisitors(data);

        renderList(list, {
          json: optBool(options, "json"),
          empty: "no active visitors at the gate",
          line: (value) => describeVisitor(toVisitor(value)),
          summary: (count) => `${count} visitor(s)`,
        });
      },
    },
    passes: {
      summary: "Browse your visitor passes (paginated)",
      options: passesOptions,
      async run({ options }) {
        const session = await requireSession();
        const passType = optString(options, "type") ?? "history";
        const allowed = ["history", "inside", "upcoming", "packages"];
        if (!allowed.includes(passType))
          fail(`--type must be one of: ${allowed.join(", ")}`);
        const offset = optNumber(options, "offset") ?? 0;

        const { data } = await getMyVisitorPasses(session, {
          passType,
          ...offsetParamFor(passType, offset),
        });
        const { passes, offsets } = extractPasses(data);
        const next = offsets?.[offsetKeyFor(passType)];

        renderList(passes, {
          json: optBool(options, "json"),
          empty: `no ${passType} passes at offset ${offset}`,
          line: describePass,
          summary: (count) =>
            `${count} ${passType} pass(es) at offset ${offset}`,
          trailer: next != null ? `next offset: ${next}` : undefined,
        });
      },
    },
    packages: {
      summary: "List parcels left at the gate awaiting acceptance",
      options: packagesOptions,
      async run({ options }) {
        const session = await requireSession();
        const offset = optNumber(options, "offset") ?? 0;
        const { data } = await getMyVisitorPasses(session, {
          passType: "packages",
          packagesOffset: offset,
        });
        const { passes } = extractPasses(data);

        renderList(passes, {
          json: optBool(options, "json"),
          empty: "no packages waiting at the gate",
          line: describePass,
          summary: (count) => `${count} package(s)`,
        });
      },
    },
    approve: decisionCommand({
      summary: "Approve a visitor by gate pass id",
      status: "approved",
      label: "approved",
      tint: color.green,
    }),
    reject: decisionCommand({
      summary: "Reject a visitor by gate pass id",
      status: "rejected",
      label: "rejected",
      tint: color.yellow,
    }),
    accept: decisionCommand({
      summary: "Accept a package (leave-at-gate) for a visitor",
      status: "accept package",
      label: "package accepted",
      tint: color.green,
    }),
  },
};
