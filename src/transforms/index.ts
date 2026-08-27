/**
 * The generation catalog: what the working page offers and what its generate
 * route accepts. The format lives here, server-side, so whoever uploads hands
 * over raw material instead of following a per-format skill - and a prompt edit
 * reaches every share with nothing republished. Each prompt is its own .md
 * because the eval harness (evals/transforms/) reads the same files off disk;
 * this file only binds names, copy, and prompts together for the Worker bundle.
 */

import agendaPrompt from './agenda.md';
import deckPrompt from './deck.md';
import renewalPrompt from './renewal.md';
import shipSummaryPrompt from './ship-summary.md';
import type { AiRunner } from '../lib/types';
import { type TransformSource, runPrompt } from './prompt';

export interface Generation {
  /** The name the POST body carries and the stem the output lands under. */
  name: string;
  label: string;
  sub: string;
  prompt: string;
}

/** Order is button order on the working page. */
export const GENERATIONS: Generation[] = [
  { name: 'deck', label: 'deck', prompt: deckPrompt,
    sub: 'a Marp deck, one idea per slide' },
  { name: 'agenda', label: 'agenda', prompt: agendaPrompt,
    sub: 'a meeting someone could run from it' },
  { name: 'renewal', label: 'renewal summary', prompt: renewalPrompt,
    sub: 'what the engagement delivered, for the client' },
  { name: 'ship-summary', label: 'ship summary', prompt: shipSummaryPrompt,
    sub: "the week's work, deck-shaped" },
];

/* A Map: the name arrives off a POST body, an open key. */
const PROMPTS = new Map(GENERATIONS.map((g) => [g.name, g.prompt]));

export function promptFor(name: string): string | undefined {
  return PROMPTS.get(name);
}

/* ~50k tokens across the whole run: far past any notes file, far under the
   context window, and a bounded spend per generation. Per run rather than per
   file, because several ticked sources compose into one prompt now. */
export const MAX_TRANSFORM_BYTES = 200_000;

/** The files a generation can read; everything else is material a browser
    renders, not text a model can compose from. */
export function transformable(path: string): boolean {
  return /\.(md|markdown|txt)$/i.test(path);
}

/** Many sources in, one document out, in the order the caller ticked them. */
export function runTransform(
  ai: AiRunner, name: string, sources: readonly TransformSource[],
): Promise<string | null> {
  const prompt = promptFor(name);
  if (prompt === undefined) return Promise.resolve(null);
  return runPrompt(ai, prompt, sources);
}
