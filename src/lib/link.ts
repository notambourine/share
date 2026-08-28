import type { Meta } from './types';

/** A lone file links straight at itself rather than at a one-row index. */
export function fileSuffix(meta: Meta): string {
  return meta.files.length === 1 && meta.files[0].path !== 'index.html'
    ? encodeURI(meta.files[0].path) : '';
}

export function publicUrl(origin: string, meta: Meta): string {
  return `${origin}/${meta.space}/${meta.hash}/${fileSuffix(meta)}`;
}
