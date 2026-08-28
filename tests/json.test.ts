import { describe, expect, it } from 'vitest';
import type { Serializable } from '../src/lib/json';
import { decodeTextMap, parseObject } from '../src/lib/json';
import { decodeMeta } from '../src/lib/r2';

const META = {
  space: 'acme', hash: 'Xk92mQ7bTp01', uploader: 'tom',
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

  /* Every share is open now, so a record that still carries the retired tier
     field decodes without it rather than being refused: those records are the
     ones already in the bucket. */
  it('drops a retired field rather than failing the record', () => {
    expect(decodeMeta(json({ ...META, tier: 'signed' }))).toEqual(META);
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
