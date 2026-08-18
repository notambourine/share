import { describe, expect, it } from 'vitest';
import type { Serializable } from '../src/lib/json';
import { decodeTextMap, parseObject } from '../src/lib/json';
import { decodeMeta } from '../src/lib/r2';

const META = {
  space: 'acme', hash: 'Xk92mQ7bTp01', tier: 'open', uploader: 'tom',
  createdAt: 100, expiresAt: null,
  files: [{ path: 'deck.md', size: 8, type: 'text/markdown; charset=utf-8' }],
};

const json = (value: Serializable) => JSON.stringify(value);

describe('parseObject', () => {
  it('takes an object and refuses everything else JSON can be', () => {
    expect(parseObject('{"a":1}')).toEqual({ a: 1 });
    expect(parseObject('[1,2]')).toBeNull();
    expect(parseObject('"text"')).toBeNull();
    expect(parseObject('null')).toBeNull();
    expect(parseObject('not json')).toBeNull();
  });
});

describe('decodeTextMap', () => {
  /* TOKENS and SIGNING_KEYS both run through this. Half a token map is worse
     than none: it would authenticate some people and 401 the rest with no
     signal about which, so one bad value rejects the whole secret. */
  it('rejects the whole map when one value is not a string', () => {
    expect(decodeTextMap(json({ tom: 'abc', sam: 'def' }))).toEqual({ tom: 'abc', sam: 'def' });
    expect(decodeTextMap(json({ tom: 'abc', sam: 7 }))).toBeNull();
    expect(decodeTextMap('{')).toBeNull();
  });
});

describe('decodeMeta', () => {
  it('reads a record this Worker wrote', () => {
    expect(decodeMeta(json(META))).toEqual(META);
  });

  /* The router asks meta.tier whether a link needs a signature, so a record
     that lost the field, or carries a spelling nobody ships, has to land on
     the locked answer rather than on the open one. */
  it('demands a token for any tier but the literal open', () => {
    expect(decodeMeta(json({ ...META, tier: 'signed' }))?.tier).toBe('signed');
    expect(decodeMeta(json({ ...META, tier: 'Open' }))?.tier).toBe('signed');
    expect(decodeMeta(json({ ...META, tier: true }))).toBeNull();
  });

  it('refuses a record missing a field the router reads', () => {
    expect(decodeMeta(json({ ...META, createdAt: 'today' }))).toBeNull();
    expect(decodeMeta(json({ ...META, files: [{ path: 'a.md', size: 8 }] }))).toBeNull();
    expect(decodeMeta(json({ ...META, files: 'deck.md' }))).toBeNull();
  });

  /* null is the answer that means "never expires". Reading it as a missing
     field would trash live uploads. */
  it('keeps a null expiry as a null expiry', () => {
    expect(decodeMeta(json({ ...META, expiresAt: null }))?.expiresAt).toBeNull();
  });
});
