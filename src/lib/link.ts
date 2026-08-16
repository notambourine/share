import type { Env, Meta } from './types';
import { mintToken } from './sign';
import { genSlug } from './keys';

/** A lone file links straight at itself rather than at a one-row index. */
function fileSuffix(meta: Meta): string {
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
  short?: string;
}

/** `short` parks a `/z/<id>` redirect that expires with the link it wraps. */
export async function mintArtifactLink(
  env: Env, keys: Record<string, string>, origin: string, meta: Meta,
  exp: number, t: number, short = false,
): Promise<ArtifactLink> {
  const token = await mintToken(keys, `${meta.space}/${meta.hash}`, exp);
  const url = `${origin}/${meta.space}/${meta.hash}/k/${token}/${fileSuffix(meta)}`;
  const out: ArtifactLink = { url, exp };
  if (short) {
    const id = genSlug(8);
    await env.LINKS.put(
      `z/${id}`,
      JSON.stringify({ target: url }),
      exp === 0 ? {} : { expirationTtl: Math.max(60, exp - t) },
    );
    out.short = `${origin}/z/${id}`;
  }
  return out;
}
