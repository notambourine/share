import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/* The offline half of scripts/vendor-skills.mjs, run by `npm test` so the three-command
   verify contract in CLAUDE.md still covers vendored skills. Drift against upstream is
   a network check and lives in .github/workflows/vendor-skills.yml instead. */

type VendoredSkill = {
  name: string;
  repo: string;
  ref: string;
  path: string;
  exclude?: string[];
  license: string;
  sha: string | null;
  files: Record<string, string> | null;
  copyright: string | null;
};

// String paths, not URLs: the workers-types `URL` global is not node's `URL`.
const root = fileURLToPath(import.meta.url).replace(/tests\/[^/]+$/, '');
const read = (rel: string) => readFileSync(`${root}${rel}`, 'utf8');
const manifest = JSON.parse(read('vendor/skills.json')) as { skills: VendoredSkill[] };
const digestOf = (text: string) => `sha256-${createHash('sha256').update(text).digest('base64')}`;
const stripMarker = (text: string) => text.replace(/^<!-- vendored:[^\n]*-->\n/m, '');

describe('vendored skills', () => {
  it.each(manifest.skills)('$name is pinned to an upstream commit', (skill) => {
    expect(skill.sha, 'run `npm run vendor:skills pull`').toMatch(/^[0-9a-f]{40}$/);
    expect(Object.keys(skill.files ?? {}).length).toBeGreaterThan(0);
  });

  it.each(manifest.skills)('$name has an unmodified merge base', (skill) => {
    for (const [path, digest] of Object.entries(skill.files ?? {})) {
      expect(digestOf(read(`vendor/pristine/${skill.name}/${path}`)), path).toBe(digest);
    }
  });

  it.each(manifest.skills)('$name is vendored whole, not just its entry point', (skill) => {
    for (const path of Object.keys(skill.files ?? {})) {
      expect(existsSync(`${root}.claude/skills/${skill.name}/${path}`), path).toBe(true);
    }
  });

  /* The bug this suite exists for: vendoring SKILL.md alone left `references/tells.md`,
     `DEEPENING.md`, and `HTML-REPORT.md` as dead links in shipped skills. */
  it.each(manifest.skills)('$name resolves every relative link it makes', (skill) => {
    const dir = `.claude/skills/${skill.name}`;
    for (const file of Object.keys(skill.files ?? {})) {
      if (!file.endsWith('.md')) continue;
      const links = [...read(`${dir}/${file}`).matchAll(/\]\(([^)#:]+\.\w+)\)/g)].map((m) => m[1]);
      for (const link of links) {
        if (link.startsWith('/') || link.startsWith('..')) continue;
        expect(existsSync(`${root}${dir}/${link}`), `${skill.name}/${file} -> ${link}`).toBe(true);
      }
    }
  });

  it.each(manifest.skills)('$name carries its provenance marker', (skill) => {
    const live = read(`.claude/skills/${skill.name}/SKILL.md`);
    expect(live).toContain(`<!-- vendored: ${skill.repo}@`);
    expect(stripMarker(live).length).toBeGreaterThan(0);
  });

  it.each(manifest.skills)('$name license text travels with the copy', (skill) => {
    const file = `vendor/licenses/${skill.repo.replace('/', '-')}.txt`;
    expect(existsSync(`${root}${file}`)).toBe(true);
    expect(read(file)).toMatch(/copyright/i);
  });

  it('gives every skill a distinct name', () => {
    const names = manifest.skills.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
  });

  /* The whole point of .claude/skills/: these load for whoever works in this repo and
     never ship. skills/ plus .claude-plugin/plugin.json is what an employee installs. */
  it('keeps vendored skills out of the published plugin surface', () => {
    expect(readdirSync(`${root}skills`)).toEqual(['share']);
  });
});
