import type { Meta } from './types';
import type { SigningKeys } from './sign';
import { mintToken } from './sign';

/** A lone file links straight at itself rather than at a one-row index. */
export function fileSuffix(meta: Meta): string {
  return meta.files.length === 1 && meta.files[0].path !== 'index.html'
    ? encodeURI(meta.files[0].path) : '';
}

export function publicUrl(origin: string, meta: Meta): string {
  return `${origin}/${meta.space}/${meta.hash}/${fileSuffix(meta)}`;
}

export interface ArtifactLink {
  url: string;
  /** Epoch seconds; 0 = no expiry. */
  exp: number;
}

export async function mintArtifactLink(
  keys: SigningKeys, origin: string, meta: Meta, exp: number,
): Promise<ArtifactLink> {
  const token = await mintToken(keys, `${meta.space}/${meta.hash}`, exp);
  return { url: `${origin}/${meta.space}/${meta.hash}/k/${token}/${fileSuffix(meta)}`, exp };
}
