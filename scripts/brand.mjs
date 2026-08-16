/* Where the golden set sits once the submodule is checked out. One constant,
   because vendor.mjs copies out of it and brand-audit.mjs checks against it. */
import { readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const BRAND = 'upstream/nt-brand/plugins/nt-brand/skills/system';

/** Every face in the golden set, paired to where public/ serves it from. */
export async function fontPairs() {
  let faces;
  try {
    faces = await readdir(join(root, BRAND, 'fonts'));
  } catch {
    console.error(`${BRAND} is empty. Run \`git submodule update --init\`.`);
    process.exit(1);
  }
  return faces.map((f) => [`${BRAND}/fonts/${f}`, `public/fonts/${f}`]);
}
