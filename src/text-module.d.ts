/* Declares the shape of wrangler's `rules` Text loader, configured in wrangler.jsonc. */
declare module '*.md' {
  const content: string;
  export default content;
}

declare module '*.css' {
  const content: string;
  export default content;
}

declare module '*.svg' {
  const content: string;
  export default content;
}
