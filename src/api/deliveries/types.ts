/* Raw indexed form fields (visitor_name_0, ...) that the endpoint expects;
 * built in commands/deliveries.ts, so this stays a plain field map. */
export type IntimateExpectedVisitorsRequest = Record<string, string>;

export interface CancelIntimatedPassRequest {
  guid: string;
  reason?: string;
}
