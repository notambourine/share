/**
 * The JSON boundary. Worker secrets, stored records, and POST bodies all arrive
 * as text, and this is the one place that turns text into a domain type. Past
 * here nothing branches on a representation it did not decode.
 *
 * `JsonValue` is the grammar `JSON.parse` can return; `Serializable` is what
 * `JSON.stringify` accepts. They differ by `undefined`, which stringify drops
 * and parse can never produce, so one type cannot honestly do both jobs.
 */

export interface JsonObject { [key: string]: JsonValue }

export type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject;

export type Serializable =
  | string | number | boolean | null | undefined
  | Serializable[]
  | { [key: string]: Serializable };

/** null covers unparseable and a bare `null`; every caller here wants both to fail. */
export function parseJson(text: string): JsonValue | null {
  try {
    /* SAFETY: JSON.parse is typed `any`, and JsonValue is exactly the grammar
       it can return. Every reader below narrows before use. */
    return JSON.parse(text) as JsonValue;
  } catch {
    return null;
  }
}

export function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isText(value: JsonValue): value is string {
  return typeof value === 'string';
}

function isNumber(value: JsonValue): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function parseObject(text: string): JsonObject | null {
  const value = parseJson(text);
  return value !== null && isJsonObject(value) ? value : null;
}

export function textAt(record: JsonObject, key: string): string | null {
  const value = record[key];
  return isText(value) ? value : null;
}

export function numberAt(record: JsonObject, key: string): number | null {
  const value = record[key];
  return isNumber(value) ? value : null;
}

/** Absent and `false` are the same answer for every flag this Worker reads. */
export function flagAt(record: JsonObject, key: string): boolean {
  return record[key] === true;
}

/** Skips a non-string entry rather than rejecting the array: the one caller is
    the admin poll, which paints what the answer does carry. */
export function textsAt(record: JsonObject, key: string): string[] {
  const value = record[key];
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (isText(item)) out.push(item);
  }
  return out;
}

export function numbersAt(record: JsonObject, key: string): number[] | null {
  const value = record[key];
  if (!Array.isArray(value)) return null;
  const out: number[] = [];
  for (const item of value) {
    if (!isNumber(item)) return null;
    out.push(item);
  }
  return out;
}

export function recordsAt(record: JsonObject, key: string): JsonObject[] | null {
  const value = record[key];
  if (!Array.isArray(value)) return null;
  const out: JsonObject[] = [];
  for (const item of value) {
    if (!isJsonObject(item)) return null;
    out.push(item);
  }
  return out;
}

/** A secret that is not the documented map is a misconfiguration, not a partial
    map: one bad value rejects the whole thing so the caller answers 500. */
export function decodeTextMap(text: string): Record<string, string> | null {
  const record = parseObject(text);
  if (!record) return null;
  const entries: [string, string][] = [];
  for (const key of Object.keys(record)) {
    const value = textAt(record, key);
    if (value === null) return null;
    entries.push([key, value]);
  }
  return Object.fromEntries(entries);
}

/** Per key, unlike the text map above: this one holds retention, and one typo
    must not quietly reset every other space to the default. */
export function decodeNumberMap(text: string): Record<string, number> {
  const record = parseObject(text);
  if (!record) return {};
  const entries: [string, number][] = [];
  for (const key of Object.keys(record)) {
    const value = numberAt(record, key);
    if (value !== null) entries.push([key, value]);
  }
  return Object.fromEntries(entries);
}
