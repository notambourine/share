import agendaPrompt from './agenda.md';
import deckPrompt from './deck.md';
import renewalPrompt from './renewal.md';
import shipSummaryPrompt from './ship-summary.md';
import type { AiRunner } from '../lib/types';
import { type TransformSource, runPrompt } from './prompt';

export interface Generation {
  name: string;
  label: string;
  sub: string;
  prompt: string;
}

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

const PROMPTS = new Map(GENERATIONS.map((g) => [g.name, g.prompt]));

export function promptFor(name: string): string | undefined {
  return PROMPTS.get(name);
}

export const MAX_TRANSFORM_BYTES = 200_000;

export function transformable(path: string): boolean {
  return /\.(md|markdown|txt)$/i.test(path);
}

export function runTransform(
  ai: AiRunner, name: string, sources: readonly TransformSource[],
): Promise<string | null> {
  const prompt = promptFor(name);
  if (prompt === undefined) return Promise.resolve(null);
  return runPrompt(ai, prompt, sources);
}
