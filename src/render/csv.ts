/**
 * Delimited data, parsed in the Worker. What ships is one GET: a first window of
 * real `<table>` markup so a crawler and a no-JS reader see data, plus every row
 * as a JSON data block the grid reads on load. Nothing here fetches and nothing
 * polls.
 *
 * Papa sniffs the delimiter, so a `.csv` exported with semicolons and a `.tsv`
 * both land here correctly and neither needs a flag at the call site.
 */

import Papa from 'papaparse';
import type { Cell, ColType, Column, Table } from '../lib/table';

/* A guard, not a preference: one pathological line of commas would otherwise
   put tens of thousands of columns through the grid. Wider than any real export
   and narrow enough that the header row still lays out. */
const MAX_COLS = 512;

/* Sniffing reads a sample, not the file: a 300k-row column is the same type as
   its first few hundred non-empty values, and reading all of it to learn that
   costs a full pass per column. */
const SNIFF_ROWS = 200;

const NUMBER = /^-?\$?\s*\d{1,3}(,\d{3})*(\.\d+)?%?$|^-?\$?\s*\d*\.?\d+%?$/;
/* ISO first, then the two written forms a spreadsheet exports. Deliberately not
   `Date.parse`, which accepts "Jan" and every bare integer as a year. */
const DATE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?)?Z?$|^\d{1,2}\/\d{1,2}\/\d{2,4}$/;

/** `$1,200.50` and `45%` are numbers a reader expects to total. NaN means it
    was not one after all, which is what keeps a mixed column a string. */
function toNumber(raw: string): number {
  return Number(raw.replace(/[$,%\s]/g, ''));
}

/* The line between a menu and a text box. A status column has a handful of
   values and wants a dropdown; an email column has one per row and a dropdown
   there is a worse text box. Counting stops at the cap, so a high-cardinality
   column costs a partial pass rather than a set of every value in the file. */
const MAX_FACETS = 200;

function facetsOf(rows: Cell[][], index: number): string[] | null {
  const seen = new Set<string>();
  for (const row of rows) {
    const value = String(row[index] ?? '');
    if (value === '') continue;
    seen.add(value);
    if (seen.size > MAX_FACETS) return null;
  }
  return [...seen].sort();
}

function sniff(values: string[]): ColType {
  const seen = values.filter((v) => v !== '');
  if (seen.length === 0) return 'string';
  if (seen.every((v) => NUMBER.test(v) && Number.isFinite(toNumber(v)))) return 'number';
  if (seen.every((v) => DATE.test(v))) return 'date';
  return 'string';
}

/**
 * Parse into the shape the shell and the grid both read.
 *
 * `maxRows` truncates rather than refuses: a reader who opened a 400k-row export
 * is better served by the first 200k with a note than by a download card, and
 * `?raw` still hands over every byte.
 */
export function parseTable(text: string, maxRows: number): Table {
  const out = Papa.parse<string[]>(text, {
    /* Header handling is ours: Papa's `header:true` keys rows by header text,
       which collapses duplicate column names silently and loses column order on
       a ragged row. The first row is the header and the rest are data. */
    skipEmptyLines: 'greedy',
  });

  const all = out.data;
  const head = all[0] ?? [];
  const width = Math.min(
    all.reduce((n, r) => Math.max(n, r.length), 0),
    MAX_COLS,
  );

  const body = all.slice(1);
  const rows: Cell[][] = body.slice(0, maxRows).map((r) => {
    /* Padded to `width`, so a short row is empty cells rather than a hole the
       grid reads as the next column's value. */
    return Array.from({ length: width }, (_, i) => r[i] ?? '');
  });

  const cols: Column[] = [];
  for (let i = 0; i < width; i += 1) {
    const sample = rows.slice(0, SNIFF_ROWS).map((r) => String(r[i] ?? ''));
    const type = sniff(sample);
    cols.push({
      name: (head[i] ?? '').trim() || `column ${i + 1}`,
      field: `c${i}`,
      type,
      /* Only where picking from a list beats typing. A number filters by range
         and a date by text, so neither wants a menu of its own values. */
      facets: type === 'string' ? facetsOf(rows, i) : null,
    });
    if (type === 'number') {
      for (const row of rows) {
        const raw = String(row[i] ?? '');
        row[i] = raw === '' ? null : toNumber(raw);
      }
    }
  }

  return {
    cols,
    rows,
    total: body.length,
    problems: out.errors.slice(0, 5).map((e) => `row ${(e.row ?? 0) + 1}: ${e.message}`),
  };
}

/**
 * The rows that arrive as markup. Small on purpose: it is what a crawler reads
 * and what paints before the grid takes over, not a second rendering of the
 * data. The grid replaces this node wholesale on load.
 */
export const SSR_ROWS = 50;

/**
 * The rows, ready to sit inside a `<script type="application/json">`.
 *
 * Every `<` becomes its JSON escape rather than only the `</script` that could
 * close the block: `<` parses back to the same string, and escaping the
 * character instead of the sequence means no cell can open a comment or a tag
 * either. The block is a data block, so nothing in it executes regardless - this
 * is what keeps that true no matter how the markup around it moves.
 */
export function dataBlock(table: Table): string {
  const payload = { cols: table.cols, rows: table.rows, total: table.total };
  return JSON.stringify(payload).replace(/</g, '\\u003c');
}
