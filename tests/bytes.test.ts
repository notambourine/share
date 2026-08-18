import { describe, expect, it } from 'vitest';
import { parseRange } from '../src/lib/bytes';

/* Anything malformed answers null, which the caller turns into a full 200
   rather than a 416: a seeking <video> retries, a broken header still reads. */
describe('parseRange', () => {
  it('takes a closed range', () => {
    expect(parseRange('bytes=0-4', 10)).toEqual({ offset: 0, length: 5 });
    expect(parseRange(' bytes=2-2 ', 10)).toEqual({ offset: 2, length: 1 });
  });

  it('runs an open-ended range to the last byte', () => {
    expect(parseRange('bytes=5-', 10)).toEqual({ offset: 5, length: 5 });
    expect(parseRange('bytes=0-', 10)).toEqual({ offset: 0, length: 10 });
  });

  it('counts a suffix range back from the end, and stops at the start', () => {
    expect(parseRange('bytes=-3', 10)).toEqual({ offset: 7, length: 3 });
    expect(parseRange('bytes=-99', 10)).toEqual({ offset: 0, length: 10 });
  });

  it('clamps an end past the last byte', () => {
    expect(parseRange('bytes=5-99', 10)).toEqual({ offset: 5, length: 5 });
  });

  it('answers null for anything it cannot serve', () => {
    expect(parseRange(null, 10)).toBeNull();
    expect(parseRange('bytes=-', 10)).toBeNull();
    expect(parseRange('bytes=-0', 10)).toBeNull();
    expect(parseRange('bytes=10-', 10)).toBeNull();
    expect(parseRange('bytes=7-3', 10)).toBeNull();
    expect(parseRange('bytes=0-4, 6-9', 10)).toBeNull();
    expect(parseRange('items=0-4', 10)).toBeNull();
  });
});
