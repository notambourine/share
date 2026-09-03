/**
 * The grid's shape, and the decoder that reads it back.
 *
 * The Worker parses a csv into this and serializes it into the page; the grid in
 * src/client/table.ts reads it out of the data block. That block is text
 * crossing a boundary like any other, so it decodes here rather than being
 * parsed and asserted at the call site.
 */

import { parseJson, isJsonObject, type JsonObject, type JsonValue } from './json';

/** How a column sorts, and whether a total under it means anything. Sniffed
    from the values rather than declared, because a csv carries no schema. */
export type ColType = 'number' | 'date' | 'string';

export interface Column {
  /** The header cell as written, or `column N` when the header was blank: an
      empty label leaves the filter and group menus with nothing to name. */
  name: string;
  /** Stable key into a row object; header text is not unique enough. */
  field: string;
  type: ColType;
  /** Every distinct value, when there are few enough to pick from a list.
      null means the column is too various for a dropdown and filters by typing
      instead - a status column gets a menu, an email column gets a box. */
  facets: string[] | null;
}

/** A parsed cell. A numeric column carries numbers so a column total is a sum
    rather than a concatenation; everything else stays the string as written. */
export type Cell = string | number | null;

export interface Table {
  cols: Column[];
  rows: Cell[][];
  /** Rows the file holds, which exceeds `rows.length` when the cap truncated. */
  total: number;
  /** Papa's per-row complaints, capped. Malformed input still renders. */
  problems: string[];
}

function isColType(value: JsonValue): value is ColType {
  return value === 'number' || value === 'date' || value === 'string';
}

function isCell(value: JsonValue): value is Cell {
  return value === null || typeof value === 'string'
    || (typeof value === 'number' && Number.isFinite(value));
}

function isText(value: JsonValue): value is string {
  return typeof value === 'string';
}

function isCount(value: JsonValue): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function decodeFacets(value: JsonValue | undefined): string[] | null {
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  for (const item of value) {
    if (!isText(item)) return null;
    out.push(item);
  }
  return out;
}

function decodeColumn(record: JsonObject): Column | null {
  const { name, field, type } = record;
  if (!isText(name) || !isText(field) || !isColType(type)) return null;
  return { name, field, type, facets: decodeFacets(record.facets) };
}

/**
 * Read the data block back into a table, or null if it is not one. A page that
 * fails here keeps the server-rendered rows it already painted, which is the
 * whole reason those rows are in the markup.
 */
export function decodeTable(text: string): Table | null {
  const value = parseJson(text);
  if (value === null || !isJsonObject(value)) return null;

  const { cols, rows, total } = value;
  if (!Array.isArray(cols) || !Array.isArray(rows) || !isCount(total)) return null;

  const columns: Column[] = [];
  for (const item of cols) {
    if (!isJsonObject(item)) return null;
    const col = decodeColumn(item);
    if (col === null) return null;
    columns.push(col);
  }

  const cells: Cell[][] = [];
  for (const item of rows) {
    if (!Array.isArray(item)) return null;
    const row: Cell[] = [];
    for (const cell of item) {
      if (!isCell(cell)) return null;
      row.push(cell);
    }
    cells.push(row);
  }

  return { cols: columns, rows: cells, total, problems: [] };
}

/** Rows keyed the way the grid wants them. The wire carries arrays, because a
    key repeated on every one of 200k rows is most of the payload. */
export function toRecords(table: Table): Record<string, Cell>[] {
  return table.rows.map((row) => {
    const out: Record<string, Cell> = {};
    table.cols.forEach((col, i) => { out[col.field] = row[i] ?? null; });
    return out;
  });
}
