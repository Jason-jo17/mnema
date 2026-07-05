/**
 * Which /app pages exist in this build.
 *
 * The open-core carve ships without the enterprise pages (graph, meetings,
 * admin) while the private source-of-truth has them. `import.meta.glob` is
 * resolved at build time, so route presence is read off the pages actually in
 * the tree — the same Sidebar works in both builds with no per-build config.
 *
 * Server-side only: import this from .astro frontmatter and pass booleans
 * down as props. Importing it from a client-hydrated component would drag
 * every page into the client bundle via the glob's dynamic imports.
 */
const appPages = import.meta.glob('../pages/app/**/*.astro');

/** True when a page under /app/<prefix> is part of this build. */
export function hasAppRoute(prefix: string): boolean {
  return Object.keys(appPages).some((path) =>
    path.startsWith(`../pages/app/${prefix}`),
  );
}
