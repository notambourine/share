/* Declares the shape of wrangler's `rules` Text loader, configured in wrangler.jsonc. */
declare module '*.md' {
  const content: string;
  export default content;
}
