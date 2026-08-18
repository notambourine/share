/**
 * The Worker's own contracts.
 *
 * `Env` names the slice of each binding this code calls rather than the whole
 * `R2Bucket` and `Fetcher`. Those declare a surface nothing here reaches, and a
 * test that had to produce one whole could only ever fake it through a cast.
 * `BindingsFit` below is what keeps the narrow contracts honest against the
 * runtime.
 */

import type { JsonValue } from './json';

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
  put(key: string, value: StoredValue, options?: {
    httpMetadata?: StoredMetadata;
  }): Promise<StoredHead | null>;
  list(options: { prefix: string; delimiter?: string; cursor?: string }): Promise<StoredPage>;
  delete(keys: string[]): Promise<void>;
}

export interface AssetServer {
  fetch(request: Request): Promise<Response>;
}

export interface AiMessage {
  role: 'system' | 'user';
  content: string;
}

/** The chat slice of a Workers AI text model's input, as src/transforms/ sends it. */
export interface AiChatInput {
  messages: AiMessage[];
  max_completion_tokens: number;
  temperature: number;
  reasoning_effort: 'low' | 'medium' | 'high';
}

/** No BindingsFit row: workers-types keys `Ai["run"]` to a closed model union
    that lags releases, so a fit against a string model id cannot be stated.
    The answer is JSON-shaped data whatever the model; decodeAiText narrows it. */
export interface AiRunner {
  run(model: string, input: AiChatInput): Promise<JsonValue>;
}

export interface Env {
  BUCKET: Store;
  ASSETS: AssetServer;
  /** Workers AI, for `?transform=` on upload (src/transforms/). Optional: a
      deploy that predates the binding still uploads; only transforms 503. */
  AI?: AiRunner;
  /** Browser Rendering, driven by @cloudflare/puppeteer, so this one stays the
      whole binding. Optional: a deploy that predates it, or an account past its
      daily browser minutes, degrades to the live shell. */
  BROWSER?: Fetcher;
  /** Secret. JSON map of uploader name -> sha256 hex of their Bearer token. */
  TOKENS: string;
  /** Secret. JSON map of key id ("v1") -> base64url signing secret. Highest id mints. */
  SIGNING_KEYS: string;
}

type Fits<From extends To, To> = From;

/** Widen a seam past what the runtime provides and the typecheck fails here,
    rather than on the first request that calls the method R2 never had. */
export type BindingsFit = [
  Fits<R2Bucket, Store>,
  Fits<Fetcher, AssetServer>,
];

export type Tier = 'open' | 'signed';

export interface MetaFile {
  path: string;
  size: number;
  type: string;
  /** Path of the frame the unfurl card shows, when the upload carried one.
      Never its own row in `files` - see src/lib/poster.ts. */
  poster?: string;
}

export interface Meta {
  space: string;
  hash: string;
  tier: Tier;
  uploader: string;
  /** Epoch seconds. */
  createdAt: number;
  /** Epoch seconds, null = never expires. */
  expiresAt: number | null;
  /** The `?transform=` name the upload's text files went through, when one did. */
  transform?: string;
  files: MetaFile[];
}

export const DEFAULT_ARTIFACT_DAYS = 90;
export const DEFAULT_LINK_DAYS = 30;
export const TRASH_PREFIX = '_trash/';
