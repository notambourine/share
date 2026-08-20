/**
 * Formatting a human reads, shared by the render layer and the CLI. It lives
 * here rather than in shell.tsx because `bin/share.ts` prints the same sizes in
 * `ls` and cannot import a .tsx: the bin project resolves node16 and the render
 * layer pulls in hono/jsx.
 */

export function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
