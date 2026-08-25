/* Decoders that flatten the visitor-endpoint envelopes (brands, passes)
 * into typed rows. */

import { isRecord, asArray, readStrings } from "#src/utils/guards.ts";
import type { VisitorOrg, VisitorPass, ExtractedPasses } from "./types.ts";

const toVisitorOrg = (value: unknown): VisitorOrg =>
  readStrings(value, [
    "org_id",
    "org_name",
    "org_purpose",
    "org_type",
    "org_logo",
  ]);

const toVisitorPass = (value: unknown): VisitorPass =>
  readStrings(value, [
    "gate_pass_id",
    "guid",
    "host_id",
    "visitor_name",
    "visitor_org",
    "to_meet",
    "visit_dates_range",
    "visit_date_time",
    "visit_date",
    "pass_status",
    "ru_num",
  ]);

/* Keeps only the string/number-valued entries as next-page offsets. */
function toOffsetDetails(value: unknown): Record<string, string | number> {
  const result: Record<string, string | number> = {};

  if (isRecord(value)) {
    for (const [key, entry] of Object.entries(value)) {
      if (typeof entry === "string" || typeof entry === "number")
        result[key] = entry;
    }
  }

  return result;
}

/* `visitor_orgs` comes back either as a flat array or as an object keyed by
 * org_type — flatten both into one list. */
export function flattenBrands(data: unknown): Array<VisitorOrg> {
  const container =
    isRecord(data) && data.visitor_orgs !== undefined
      ? data.visitor_orgs
      : data;

  const list: Array<VisitorOrg> = [];
  const flat = asArray(container);

  if (flat) {
    for (const entry of flat) list.push(toVisitorOrg(entry));
  } else if (isRecord(container)) {
    for (const [groupType, entries] of Object.entries(container)) {
      const groupList = asArray(entries);
      if (!groupList) continue;

      for (const entry of groupList) {
        const org = toVisitorOrg(entry);
        if (!org.org_type) org.org_type = groupType;
        list.push(org);
      }
    }
  }

  return list;
}

/* Pulls the pass list and next-page offsets out of the visitor-passes envelope. */
export function extractPasses(data: unknown): ExtractedPasses {
  const node =
    isRecord(data) && data.visitor_passes !== undefined
      ? data.visitor_passes
      : data;
  const passesNode = isRecord(node) ? node : {};

  const rawList = passesNode.pass_list ?? passesNode.passList;
  const rawOffsets = passesNode.offset_details ?? passesNode.offsetDetails;

  return {
    passes: (asArray(rawList) ?? []).map(toVisitorPass),
    offsets: toOffsetDetails(rawOffsets),
  };
}
