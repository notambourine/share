/**
 * The Worker's own contracts.
 *
 * `Env` names the slice of each binding this code calls rather than the whole
 * `R2Bucket`, `KVNamespace`, `Fetcher`, and `ExecutionContext`. Those declare a
 * surface nothing here reaches, and a test that had to produce one whole could
 * only ever fake it through a cast. `BindingsFit` below is what keeps the
 * narrow contracts honest against the runtime.
 */

export interface StoredHead {
  size: number;
  httpEtag: string;
}

export interface StoredMetadata {
  contentType?: string;
}

export interface StoredObject extends StoredHead {
  body: ReadableStream | null;
  httpMetadata?: StoredMetadata;
  text(): Promise<string>;
}

export interface StoredRange {
  offset: number;
  length: number;
}

export interface StoredPage {
  objects: { key: string }[];
  delimitedPrefixes: string[];
  truncated: boolean;
  cursor?: string;
}

export type StoredValue = string | Blob | ReadableStream | Uint8Array | null;

export interface Store {
  get(key: string, options?: { range?: StoredRange }): Promise<StoredObject | null>;
  head(key: string): Promise<StoredHead | null>;
  /** With `onlyIf`, a failed precondition resolves null and writes nothing. */
  put(key: string, value: StoredValue, options?: {
    httpMetadata?: StoredMetadata;
    onlyIf?: { etagMatches: string };
  }): Promise<StoredHead | null>;
  list(options: { prefix: string; delimiter?: string; cursor?: string }): Promise<StoredPage>;
  delete(keys: string[]): Promise<void>;
}

/** Short links only: one string in, one string out, and an expiry KV enforces. */
export interface LinkStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

export interface AssetServer {
  fetch(request: Request): Promise<Response>;
}

/** The half of `ExecutionContext` a route uses: work that outlives the response. */
export interface Deferrals {
  waitUntil(promise: Promise<unknown>): void;
}

export interface Env {
  BUCKET: Store;
  LINKS: LinkStore;
  ASSETS: AssetServer;
  /** Browser Rendering, driven by @cloudflare/puppeteer, so this one stays the
      whole binding. Optional: a deploy that predates it, or an account past its
      daily browser minutes, degrades to the live shell. */
  BROWSER?: Fetcher;
  /** Secret. JSON map of uploader name -> sha256 hex of their Bearer token. */
  TOKENS: string;
  /** Secret. JSON map of key id ("v1") -> base64url signing secret. Highest id mints. */
  SIGNING_KEYS: string;
  /** Secret. JSON map of space -> artifact-life days. Holds client names, so never in the repo. */
  SPACE_TTLS?: string;
}

type Fits<From extends To, To> = From;

/** Widen a seam past what the runtime provides and the typecheck fails here,
    rather than on the first request that calls the method R2 never had. */
export type BindingsFit = [
  Fits<R2Bucket, Store>,
  Fits<KVNamespace, LinkStore>,
  Fits<Fetcher, AssetServer>,
  Fits<ExecutionContext, Deferrals>,
];

export type Tier = 'open' | 'signed';

export interface MetaFile {
  path: string;
  size: number;
  type: string;
}

export interface Meta {
  space: string;
  hash: string;
  tier: Tier;
  uploader: string;
  /** Epoch seconds. */
  createdAt: number;
  /** Epoch seconds, null = no fixed expiry. */
  expiresAt: number | null;
  /** Seconds since last access, null = fixed expiry only. */
  idleTtl: number | null;
  /** Epoch seconds. Rewritten at most once per day, and only when idleTtl is set. */
  lastAccess: number;
  files: MetaFile[];
}

export const DEFAULT_ARTIFACT_DAYS = 90;
export const DEFAULT_LINK_DAYS = 30;
export const TRASH_PREFIX = '_trash/';
