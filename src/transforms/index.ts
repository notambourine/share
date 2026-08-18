/**
 * The transform registry: what `?transform=` on POST /up accepts. The format
 * lives here, server-side, so the model that uploads hands over raw material
 * instead of following a per-format skill - and a prompt edit reaches every
 * uploader with nothing republished. Each prompt is its own .md because the
 * eval harness (evals/transforms/) reads the same files off disk; this file
 * only binds names to them for the Worker bundle.
 */

import agendaPrompt from './agenda.md';
import deckPrompt from './deck.md';
import performancePrompt from './performance.md';
import presentationPrompt from './presentation.md';
import renewalPrompt from './renewal.md';
import type { AiRunner } from '../lib/types';
import { runPrompt } from './prompt';

/* A Map: the name arrives off the URL, an open key. */
export const TRANSFORMS = new Map([
  ['agenda', agendaPrompt],
  ['renewal', renewalPrompt],
  ['performance', performancePrompt],
  ['presentation', presentationPrompt],
  ['deck', deckPrompt],
]);

/* ~50k tokens: far past any notes file, far under the context window, and a
   bounded spend per upload. */
export const MAX_TRANSFORM_BYTES = 200_000;

/** The files a transform rewrites; everything else rides along untouched. */
export function transformable(path: string): boolean {
  return /\.(md|markdown|txt)$/i.test(path);
}

export async function runTransform(
  ai: AiRunner, name: string, filename: string, text: string,
): Promise<string | null> {
  const prompt = TRANSFORMS.get(name);
  if (prompt === undefined) return null;
  return runPrompt(ai, prompt, filename, text);
}
