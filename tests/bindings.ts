/**
 * In-memory bindings.
 *
 * `Env` names only the storage surface the Worker actually calls, so these are
 * real implementations of that contract rather than casts at a test boundary.
 * Widen a seam and the typecheck fails here, which is the point: a double that
 * a cast keeps compiling is a double that stops matching the runtime.
 */

import type {
  AiChatInput, AiRunner, AssetServer, Deferrals, Env, LinkStore, Store,
  StoredHead, StoredObject, StoredPage, StoredValue,
} from '../src/lib/types';
import type { JsonValue } from '../src/lib/json';

const enc = new TextEncoder();
const dec = new TextDecoder();

function isText(value: StoredValue): value is string {
  return typeof value === 'string';
}

async function textOf(value: StoredValue): Promise<string> {
  if (value === null) return '';
  if (isText(value)) return value;
  if (value instanceof Uint8Array) return dec.decode(value);
  if (value instanceof Blob) return value.text();
  return new Response(value).text();
}

export interface MemoryStore extends Store {
  /** The stored bytes, so a test can seed a cache hit or assert what landed. */
  objects: Map<string, string>;
}

export function memoryStore(seed: Record<string, string> = {}): MemoryStore {
  const objects = new Map(Object.entries(seed));

  /* Content-derived, not size-derived: a conditional put must see the etag
     change when a same-length field flips (one epoch second to another). */
  const etagOf = (text: string): string => {
    let h = 5381;
    for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
    return `"${h.toString(16)}"`;
  };

  const headOf = (key: string): StoredHead | null => {
    const text = objects.get(key);
    if (text === undefined) return null;
    return { size: enc.encode(text).byteLength, httpEtag: etagOf(text) };
  };

  return {
    objects,

    async get(key, options): Promise<StoredObject | null> {
      const head = headOf(key);
      const text = objects.get(key);
      if (!head || text === undefined) return null;
      const range = options?.range;
      const bytes = enc.encode(text);
      const part = range ? bytes.slice(range.offset, range.offset + range.length) : bytes;
      return {
        ...head,
        body: new Response(part).body,
        text: async () => dec.decode(part),
      };
    },

    async head(key) {
      return headOf(key);
    },

    async put(key, value, options) {
      const match = options?.onlyIf?.etagMatches;
      if (match !== undefined && headOf(key)?.httpEtag !== match) return null;
      objects.set(key, await textOf(value));
      return headOf(key);
    },

    /* One page: nothing here holds enough keys to paginate, and a test that
       needed a cursor would be testing R2 rather than this Worker. */
    async list({ prefix, delimiter }): Promise<StoredPage> {
      const keys = [...objects.keys()].filter((key) => key.startsWith(prefix));
      if (!delimiter) {
        return { objects: keys.map((key) => ({ key })), delimitedPrefixes: [], truncated: false };
      }
      const prefixes = new Set<string>();
      const flat: { key: string }[] = [];
      for (const key of keys) {
        const cut = key.indexOf(delimiter, prefix.length);
        if (cut === -1) flat.push({ key });
        else prefixes.add(key.slice(0, cut + delimiter.length));
      }
      return { objects: flat, delimitedPrefixes: [...prefixes], truncated: false };
    },

    async delete(keys) {
      for (const key of keys) objects.delete(key);
    },
  };
}

export interface MemoryLinks extends LinkStore {
  records: Map<string, string>;
}

export function memoryLinks(): MemoryLinks {
  const records = new Map<string, string>();
  return {
    records,
    async get(key) {
      return records.get(key) ?? null;
    },
    async put(key, value) {
      records.set(key, value);
    },
  };
}

export interface AiCall {
  model: string;
  input: AiChatInput;
}

export interface MemoryAi extends AiRunner {
  calls: AiCall[];
}

/** Answers in order, repeating the last; an Error entry throws instead. */
export function memoryAi(answers: (JsonValue | Error)[]): MemoryAi {
  const calls: AiCall[] = [];
  return {
    calls,
    async run(model, input) {
      const answer = answers[Math.min(calls.length, answers.length - 1)];
      calls.push({ model, input });
      if (answer instanceof Error) throw answer;
      return answer;
    },
  };
}

/** Every route treats deferred work as fire-and-forget, so a test can too. */
export const DEFERRED: Deferrals = {
  waitUntil() { /* nothing to await in a test */ },
};

export function noAssets(): AssetServer {
  return { fetch: async () => new Response('') };
}

export interface TestEnv extends Env {
  BUCKET: MemoryStore;
  LINKS: MemoryLinks;
}

export interface TestEnvOptions {
  objects?: Record<string, string>;
  tokens?: string;
  signingKeys?: string;
  assets?: AssetServer;
  ai?: AiRunner;
}

export function testEnv(options: TestEnvOptions = {}): TestEnv {
  return {
    BUCKET: memoryStore(options.objects),
    LINKS: memoryLinks(),
    ASSETS: options.assets ?? noAssets(),
    TOKENS: options.tokens ?? '{}',
    SIGNING_KEYS: options.signingKeys ?? '{}',
    ...(options.ai && { AI: options.ai }),
  };
}
