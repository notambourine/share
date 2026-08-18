/* Where the golden set sits once `npm ci` has run. One constant, because
   vendor.mjs copies out of it and brand-audit.mjs checks against it. */
import { readdir, rm } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const BRAND = 'node_modules/@notambourine/brand-kit';

/* The two directories a static asset server should serve rather than the
   bundle: font binaries and logo artwork. Both keep their tree shape, because
   `logo/site.webmanifest` names its icons by relative path. */
const DIRS = ['fonts', 'logo'];

/**
 * Every file in those directories, paired to where public/ serves it from.
 * Recursive, so `logo/export/*.png` lands under `public/logo/export/`.
 */
export async function brandCopies() {
  const pairs = [];
  for (const dir of DIRS) {
    const from = join(root, BRAND, dir);
    let entries;
    try {
      entries = await readdir(from, { recursive: true, withFileTypes: true });
    } catch {
      console.error(`${BRAND} is missing. Run \`npm ci\`.`);
      process.exit(1);
    }
    for (const e of entries) {
      if (!e.isFile()) continue;
      const rel = relative(from, join(e.parentPath, e.name)).split('\\').join('/');
      pairs.push([`${BRAND}/${dir}/${rel}`, `public/${dir}/${rel}`]);
    }
  }
  return pairs;
}

/** Emptied before a copy, so a file the kit renamed leaves nothing behind. */
export async function clearBrandCopies() {
  for (const dir of DIRS) await rm(join(root, 'public', dir), { recursive: true, force: true });
}
