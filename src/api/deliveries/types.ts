/*
 * The intimate endpoint takes the app's raw indexed form fields
 * (visitor_name_0, visit_date_0, ...) — the CLI builds them in
 * commands/deliveries.ts, so the request stays a plain field map.
 */
export type IntimateExpectedVisitorsRequest = Record<string, string>;

export interface CancelIntimatedPassRequest {
  guid: string;
  reason?: string;
}
