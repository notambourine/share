/**
 * In-memory bindings.
 *
 * `Env` names only the storage surface the Worker actually calls, so these are
 * real implementations of that contract rather than casts at a test boundary.
 * Widen a seam and the typecheck fails here, which is the point: a double that
 * a cast keeps compiling is a double that stops matching the runtime.
 */

import type {
  AiChatInput, AiRunner, AssetServer, Env, Store,
  StoredHead, StoredObject, StoredPage, StoredValue,
} from '../src/lib/types';
import type { JsonValue } from '../src/lib/json';
import worker from '../src/worker';

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

  /* Content-derived, not size-derived: `rawBytes` serves this as the HTTP
     etag, and two same-length bodies are not the same body. */
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

    async put(key, value) {
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

export function noAssets(): AssetServer {
  return { fetch: async () => new Response('') };
}

/* `scheduled` asks for the whole ExecutionContext and touches one member of it.
   Building the rest would be inventing a runtime, so the gap is a cast: a
   handler that reached past waitUntil breaks here, loudly, instead of in
   production.
   SAFETY: waitUntil is the only member the handler touches. */
const asCtx = (deferrals: Pick<ExecutionContext, 'waitUntil'>): ExecutionContext =>
  deferrals as ExecutionContext;

/**
 * Through the front door: the dispatch order in src/worker.ts is the security
 * model - an uploaded file named `config`, `admin`, or `generate` keeps its GET
 * - and only a test that crosses this seam can hold it.
 */
export function fetchWorker(env: Env, request: Request): Promise<Response> {
  return worker.fetch(request, env);
}

const SCHEDULE: ScheduledController = { scheduledTime: 0, cron: '0 3 * * *', noRetry() { /* no retry to skip */ } };

/** The nightly cron, same seam. The sweep runs inside waitUntil, so this awaits
    what the handler deferred rather than returning before it ran. */
export async function scheduledWorker(env: Env): Promise<void> {
  const deferred: Promise<unknown>[] = [];
  await worker.scheduled(SCHEDULE, env, asCtx({
    waitUntil(promise) { deferred.push(promise); },
  }));
  await Promise.all(deferred);
}

export interface TestEnv extends Env {
  BUCKET: MemoryStore;
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
    ASSETS: options.assets ?? noAssets(),
    TOKENS: options.tokens ?? '{}',
    SIGNING_KEYS: options.signingKeys ?? '{}',
    ...(options.ai && { AI: options.ai }),
  };
}
