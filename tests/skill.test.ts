import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { skillDoc } from '../src/skill';

describe('skillDoc', () => {
  it('serves the plugin skill byte-for-byte', async () => {
    // Read from disk, not via the .md import: importing would compare the
    // loader's output against itself and prove nothing. Path is cwd-relative.
    const onDisk = readFileSync('skills/share/SKILL.md', 'utf8');
    expect(await skillDoc().text()).toBe(onDisk);
  });

  it('is markdown, not plain text', () => {
    expect(skillDoc().headers.get('content-type')).toBe('text/markdown; charset=utf-8');
  });
});
