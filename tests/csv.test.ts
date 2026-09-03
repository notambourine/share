import { describe, expect, it } from 'vitest';
import { parseTable, dataBlock } from '../src/render/csv';
import { decodeTable, toRecords } from '../src/lib/table';
import { kindOf, contentTypeFor } from '../src/lib/keys';
import { viewModeFor } from '../src/lib/negotiate';
import { fileShell } from '../src/render/shell';

const BROWSER = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';
const CURL = '*/*';
const q = (s = '') => new URLSearchParams(s);

const SALES = [
  'region,rep,closed,amount',
  'west,ana,2026-01-04,1200.50',
  'west,bo,2026-02-11,"3,400"',
  'east,ana,2026-03-02,50',
].join('\n');

describe('kind and negotiation', () => {
  it('delimited data is its own kind, not source', () => {
    expect(kindOf('sales.csv')).toBe('table');
    expect(kindOf('sales.tsv')).toBe('table');
    expect(kindOf('main.ts')).toBe('code');
    expect(contentTypeFor('sales.tsv')).toBe('text/tab-separated-values; charset=utf-8');
  });

  it('grid for a browser, bytes for curl, source on request', () => {
    expect(viewModeFor('sales.csv', BROWSER, q())).toBe('shell-table');
    expect(viewModeFor('sales.csv', CURL, q())).toBe('raw');
    expect(viewModeFor('sales.csv', BROWSER, q('raw'))).toBe('raw');
    expect(viewModeFor('sales.csv', BROWSER, q('view=source'))).toBe('shell-code');
  });
});

describe('parseTable', () => {
  it('reads the header row and every column', () => {
    const t = parseTable(SALES, 100);
    expect(t.cols.map((c) => c.name)).toEqual(['region', 'rep', 'closed', 'amount']);
    expect(t.total).toBe(3);
    expect(t.rows).toHaveLength(3);
  });

  it('sniffs number, date, and string columns', () => {
    const t = parseTable(SALES, 100);
    expect(t.cols.map((c) => c.type)).toEqual(['string', 'string', 'date', 'number']);
  });

  it('a quoted thousands separator is a number, not a second column', () => {
    const t = parseTable(SALES, 100);
    // "3,400" is one cell, and it totals as 3400 rather than concatenating.
    expect(t.rows[1]).toEqual(['west', 'bo', '2026-02-11', 3400]);
    expect(t.rows[0][3]).toBe(1200.5);
  });

  it('offers a menu for a repeating column and none for a unique one', () => {
    const t = parseTable(SALES, 100);
    expect(t.cols[0].facets).toEqual(['east', 'west']);
    // A number filters by typing, so it never carries a value list.
    expect(t.cols[3].facets).toBeNull();
  });

  it('sniffs the delimiter rather than trusting the extension', () => {
    const t = parseTable('a;b\n1;2', 100);
    expect(t.cols.map((c) => c.name)).toEqual(['a', 'b']);
    expect(t.rows[0]).toEqual([1, 2]);
  });

  it('a quoted newline stays one cell', () => {
    const t = parseTable('note,n\n"line one\nline two",4', 100);
    expect(t.rows).toHaveLength(1);
    expect(t.rows[0][0]).toBe('line one\nline two');
  });

  it('pads a short row instead of shifting it left', () => {
    const t = parseTable('a,b,c\n1,2\n4,5,6', 100);
    // The third column sniffs numeric off its one value, so the hole is null
    // rather than an empty string: a gap is not a zero in a total.
    expect(t.rows[0]).toEqual([1, 2, null]);
    expect(t.rows[1]).toEqual([4, 5, 6]);
  });

  it('names a blank header rather than leaving the menus empty', () => {
    const t = parseTable('a,,c\n1,2,3', 100);
    expect(t.cols[1].name).toBe('column 2');
  });

  it('truncates past the cap and still reports the real total', () => {
    const rows = Array.from({ length: 40 }, (_, i) => `r${i},${i}`).join('\n');
    const t = parseTable(`name,n\n${rows}`, 10);
    expect(t.rows).toHaveLength(10);
    expect(t.total).toBe(40);
  });

  it('an empty file is a table with no rows, not a throw', () => {
    const t = parseTable('', 100);
    expect(t.rows).toEqual([]);
    expect(t.total).toBe(0);
  });
});

describe('dataBlock', () => {
  it('a cell cannot open a tag or close the script that carries it', () => {
    const t = parseTable('a\n"</script><img onerror=x>"', 100);
    const json = dataBlock(t);
    expect(json).not.toContain('<');
    expect(json).toContain('\\u003c/script');
    // Escaped for the parser, identical for the reader.
    expect(decodeTable(json)?.rows[0][0]).toBe('</script><img onerror=x>');
  });

  it('round-trips through the decoder the grid uses', () => {
    const t = parseTable(SALES, 100);
    const back = decodeTable(dataBlock(t));
    expect(back?.rows).toEqual(t.rows);
    expect(back?.cols).toEqual(t.cols);
    expect(back?.total).toBe(3);
  });

  it('refuses anything that is not a table', () => {
    expect(decodeTable('nonsense')).toBeNull();
    expect(decodeTable('{"cols":[],"rows":[]}')).toBeNull();
    expect(decodeTable('{"cols":[{"name":"a"}],"rows":[],"total":0}')).toBeNull();
  });

  it('keys rows by field for the grid', () => {
    const t = parseTable(SALES, 100);
    expect(toRecords(t)[0]).toEqual({ c0: 'west', c1: 'ana', c2: '2026-01-04', c3: 1200.5 });
  });
});

describe('the grid shell', () => {
  const html = (source: string, opts = {}) => {
    const t = parseTable(source, 100);
    return fileShell(
      { path: 'sales.csv', rawHref: '/s/h/sales.csv?raw', size: 400, ...opts },
      { kind: 'table', table: t, json: dataBlock(t) },
    );
  };

  it('carries the rows as markup as well as data', () => {
    const out = html(SALES);
    expect(out).toContain('<th scope="col">region</th>');
    expect(out).toContain('<td>west</td>');
    expect(out).toContain('<script type="application/json" data-rows="true">');
    expect(out).toContain('/nt-table.css');
    expect(out).toContain('src="/table.js"');
  });

  it('offers every column to group by', () => {
    expect(html(SALES)).toContain('<option value="c0">region</option>');
  });

  it('escapes a header that is markup, in the table and in the data', () => {
    const out = html('<img src=x onerror=1>,b\n1,2');
    expect(out).not.toContain('<img src=x');
    expect(out).toContain('&lt;img');
    expect(out).toContain('\\u003cimg src=x');
  });

  it('says so when the cap truncated', () => {
    const rows = Array.from({ length: 40 }, (_, i) => `r${i},${i}`).join('\n');
    const t = parseTable(`name,n\n${rows}`, 10);
    const out = fileShell(
      { path: 'big.csv', rawHref: '/s/h/big.csv?raw' },
      { kind: 'table', table: t, json: dataBlock(t) },
    );
    expect(out).toContain('showing the first 10 rows of 40');
  });
});
