export interface Env {
  BUCKET: R2Bucket;
  LINKS: KVNamespace;
  ASSETS: Fetcher;
  /** Secret. JSON map of uploader name -> sha256 hex of their Bearer token. */
  TOKENS: string;
  /** Secret. JSON map of key id ("v1") -> base64url signing secret. Highest id mints. */
  SIGNING_KEYS: string;
  /** Secret. JSON map of space -> artifact-life days. Holds client names, so never in the repo. */
  SPACE_TTLS?: string;
}

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
