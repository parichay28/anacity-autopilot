/*
 * Narrowing `unknown` without casts. The API envelope and FCM pushes are parsed
 * as `unknown`; these narrow that data without any `as` cast, so every field
 * read stays honest about being optional.
 */

export function isRecord(value: unknown): value is Record<string, unknown> {
  /* Arrays are objects too, and a caller that narrowed one to a record would
   * read `.someKey` as undefined instead of getting a type error. */
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function asNumber(value: unknown): number | undefined {
  /* NaN is typeof "number" but unusable as an offset or a count. */
  return typeof value === "number" && !Number.isNaN(value) ? value : undefined;
}

export function asArray(value: unknown): ReadonlyArray<unknown> | undefined {
  return Array.isArray(value) ? value : undefined;
}

export function readString(value: unknown, key: string): string | undefined {
  return isRecord(value) ? asString(value[key]) : undefined;
}

/* Reads a fixed set of string fields off a loose object into a typed record.
 * Collapses the repeated `field: readString(value, "field")` builders — the key
 * list doubles as the field list. */
export function readStrings<Key extends string>(
  value: unknown,
  keys: ReadonlyArray<Key>,
): { [Field in Key]?: string } {
  const result: { [Field in Key]?: string } = {};
  for (const key of keys) result[key] = readString(value, key);
  return result;
}

export function toStringRecord(value: unknown): Record<string, string> {
  const result: Record<string, string> = {};
  if (isRecord(value)) {
    for (const [key, entry] of Object.entries(value)) {
      if (typeof entry === "string") result[key] = entry;
    }
  }
  return result;
}
