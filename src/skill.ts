/**
 * GET /SKILL.md — the same bytes the published plugin installs.
 * The import is load-bearing: it makes drift between the served doc and the
 * skill impossible, where a copy in public/ could only be detected after it.
 */
import SKILL from '../skills/share/SKILL.md';
import { ROBOTS } from './lib/http';

export function skillDoc(): Response {
  return new Response(SKILL, {
    headers: {
      'content-type': 'text/markdown; charset=utf-8',
      'x-robots-tag': ROBOTS,
      'cache-control': 'public, max-age=3600',
    },
  });
}
