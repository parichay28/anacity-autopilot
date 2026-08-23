import { color, out, emit } from "#src/utils/terminal.ts";
import { flattenBrands } from "#src/api/visitors/utils.ts";
import { getVisitorOrgs } from "#src/api/visitors/visitors.ts";
import { optString, optBool, requireSession } from "#src/cli/utils.ts";
import type { CommandSpec, OptionSpec } from "#src/cli/types.ts";

const brandsOptions: ReadonlyArray<OptionSpec> = [
  {
    name: "type",
    type: "string",
    desc: "Filter by org_type (e.g. delivery, cab, food)",
  },
  {
    name: "search",
    type: "string",
    alias: "s",
    desc: "Case-insensitive name filter",
  },
  { name: "json", type: "boolean", desc: "Emit the raw brand list as JSON" },
];

export const brands: CommandSpec = {
  summary: "List the community's known visitor/delivery brands",
  options: brandsOptions,
  async run({ options }) {
    const session = await requireSession();
    const { data } = await getVisitorOrgs(session);
    let list = flattenBrands(data);

    const wanted = optString(options, "type")?.toLowerCase();
    if (wanted)
      list = list.filter(
        (org) => String(org.org_type || "").toLowerCase() === wanted,
      );

    const needle = optString(options, "search")?.toLowerCase();
    if (needle)
      list = list.filter((org) =>
        String(org.org_name || "")
          .toLowerCase()
          .includes(needle),
      );

    if (optBool(options, "json")) {
      emit(JSON.stringify(list));
      return;
    }
    if (!list.length) {
      out(color.dim("no brands matched"));
      return;
    }

    /* Group by org_type for a readable listing. */
    const byType = Map.groupBy(list, (org) => org.org_type || "other");
    for (const [type, orgs] of byType) {
      out(color.bold(type));
      for (const org of orgs) {
        const purpose = org.org_purpose
          ? color.dim(` — ${org.org_purpose}`)
          : "";
        out(
          `  ${org.org_name}${purpose} ${color.dim(`(org_id=${org.org_id})`)}`,
        );
      }
    }

    out(color.dim(`${list.length} brand(s)`));
  },
};
