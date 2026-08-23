/* ---- entities ------------------------------------------------------------ */

export interface VisitorOrg {
  org_id?: string;
  org_name?: string;
  org_purpose?: string;
  org_type?: string;
  org_logo?: string;
}

export interface VisitorPass {
  gate_pass_id?: string;
  guid?: string;
  host_id?: string;
  visitor_name?: string;
  visitor_org?: string;
  to_meet?: string;
  visit_dates_range?: string;
  visit_date_time?: string;
  visit_date?: string;
  pass_status?: string;
  ru_num?: string;
}

export interface Visitor {
  vis_name?: string;
  visitor_name?: string;
  gate_pass_id?: string;
  ru_num?: string;
  ru_id?: string;
  flat?: string;
}

/* ---- requests / responses ------------------------------------------------ */

export interface GetMyVisitorPassesRequest {
  passType?: string;
  pastOffset?: number;
  upcomingOffset?: number;
  packagesOffset?: number;
}

export interface RecordApprovalDecisionRequest {
  gatePassID: string;
  hostID: string;
  status: string;
}

export interface ResolveHostIDResponse {
  hostID: string;
  /* Which pass list supplied it, or "none" when nothing matched. */
  source: string;
  /* Set when a list could not be read: a failed lookup and a genuinely absent
   * pass both end at source="none" and are indistinguishable afterwards. */
  error?: string;
}

/* Decoded form of the visitor-passes envelope. */
export interface ExtractedPasses {
  passes: ReadonlyArray<VisitorPass>;
  offsets: Record<string, string | number>;
}
