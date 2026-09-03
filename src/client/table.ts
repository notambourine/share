/* The grid page's script. The rows already arrived - they are the JSON data
   block the Worker wrote into the page - so nothing here fetches and nothing
   polls. What this adds is the part a static table cannot do: sort, filter,
   group, and a total row that stays pinned while you scroll.

   Tabulator is imported by module rather than whole: a csv viewer never edits a
   cell, downloads a workbook, or prints, and registering only what the page uses
   keeps the bundle to the features on screen. */

import type { ColumnDefinition } from 'tabulator-tables';
import {
  Tabulator,
  ColumnCalcsModule,
  EditModule,
  FilterModule,
  FormatModule,
  GroupRowsModule,
  ResizeColumnsModule,
  ResizeTableModule,
  SortModule,
} from 'tabulator-tables';
import { wireCopy } from './copy';
import { decodeTable, toRecords, type Cell, type Column } from '../lib/table';

wireCopy();

/* EditModule earns its place without a single editable cell: the list header
   filter is the list editor wearing a different hat. */
Tabulator.registerModule([
  SortModule, FilterModule, FormatModule, EditModule,
  GroupRowsModule, ColumnCalcsModule, ResizeColumnsModule, ResizeTableModule,
]);

/** ISO sorts as text, but `3/9/2026` does not, so dates compare as instants.
    Unparseable sinks rather than throwing: a stray value in a date column is a
    row to keep, not a sort to abandon. */
function byDate(a: Cell, b: Cell): number {
  const x = Date.parse(String(a ?? ''));
  const y = Date.parse(String(b ?? ''));
  if (Number.isNaN(x)) return Number.isNaN(y) ? 0 : 1;
  if (Number.isNaN(y)) return -1;
  return x - y;
}

function columnDef(col: Column): ColumnDefinition {
  const numeric = col.type === 'number';
  return {
    title: col.name,
    field: col.field,
    sorter: numeric ? 'number' : col.type === 'date' ? byDate : 'string',
    hozAlign: numeric ? 'right' : 'left',
    /* A menu where the column has few enough values to pick from, a text box
       where it does not. The Worker decided which, because it is the side that
       has seen every row. */
    headerFilter: col.facets ? 'list' : 'input',
    headerFilterParams: col.facets
      ? { values: col.facets, clearable: true, autocomplete: true, listOnEmpty: true }
      : { elementAttributes: { title: `filter ${col.name}` } },
    /* A number column totals; the rest count. Something under every column
       means the footer reads as a row rather than as scattered figures. */
    bottomCalc: numeric ? 'sum' : 'count',
    bottomCalcParams: numeric ? { precision: 2 } : undefined,
    resizable: true,
    minWidth: 90,
    maxWidth: 360,
  };
}

const mount = document.querySelector('[data-grid]');
const block = document.querySelector('[data-rows]');
const fallback = document.querySelector('[data-fallback]');
const search = document.querySelector('[data-search]');
const group = document.querySelector('[data-group]');
const shown = document.querySelector('[data-shown]');

const table = mount && block ? decodeTable(block.textContent ?? '') : null;

/* No grid without rows it could decode. The server-rendered table is still on
   the page in that case, which is the reason it is in the markup at all. */
if (table && mount instanceof HTMLElement) {
  const grid = new Tabulator(mount, {
    data: toRecords(table),
    columns: table.cols.map(columnDef),
    /* The virtual DOM needs a height to window against; the stylesheet gives
       the mount one off the viewport, and this reads it. */
    height: '100%',
    /* Columns share the width and only scroll sideways once their minimums
       stop fitting. `fitDataStretch` sizes to content and leaves the rest of
       the page empty, which reads as a broken table on a narrow export. */
    layout: 'fitColumns',
    renderHorizontal: 'virtual',
    columnCalcs: 'both',
    placeholder: 'nothing matches',
    groupStartOpen: false,
    headerFilterLiveFilterDelay: 200,
  });

  const count = (n: number): void => {
    if (!shown) return;
    shown.textContent = n === table.total
      ? `${n.toLocaleString()} rows`
      : `${n.toLocaleString()} of ${table.total.toLocaleString()} rows`;
  };

  grid.on('tableBuilt', () => {
    /* Swapped only once the grid is really up, so a failure part way through
       leaves the reader with the static rows instead of an empty page. */
    if (fallback instanceof HTMLElement) fallback.hidden = true;
    count(table.rows.length);
  });
  grid.on('dataFiltered', (_filters, rows) => count(rows.length));

  if (search instanceof HTMLInputElement) {
    search.addEventListener('input', () => {
      const q = search.value.trim().toLowerCase();
      if (q === '') {
        /* False, so this clears the box's filter and leaves the per-column
           header filters exactly where the reader set them. */
        grid.clearFilter(false);
        return;
      }
      void grid.setFilter((row: Record<string, Cell>) => table.cols.some(
        (col) => String(row[col.field] ?? '').toLowerCase().includes(q),
      ));
    });
  }

  if (group instanceof HTMLSelectElement) {
    /* The empty option ungroups: Tabulator branches on `groupBy` being falsy,
       so the blank value clears grouping the way `false` does and stays inside
       the field type. */
    group.addEventListener('change', () => grid.setGroupBy(group.value));
  }
}
