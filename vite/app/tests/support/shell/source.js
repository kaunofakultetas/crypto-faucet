// -----------------------------------------------------------
//  [*] Test support — the SPA's source, read as text
//
//  App.jsx declares its routes as JSX inside PageArea, not as
//  an exported object, and ROUTE_TITLES / SITE_TITLE are
//  module-private — so the structural rules and the route
//  sweep read them from the source text: every <Route> with
//  its path, index flag and element, nested into full paths,
//  the title table, and the page modules App.jsx imports. A
//  small brace-aware scanner, not a JSX parser: it reads the
//  shapes App.jsx uses and THROWS on anything it cannot read,
//  so a reshaped App.jsx fails loudly instead of yielding an
//  empty table every rule would pass over.
//
//  Split into:
//
//    APP_ROOT / SRC    — where the app and its source live
//    readSource        — one file as text
//    sourceFiles       — every .js / .jsx / .mjs under a folder
//    withoutComments   — code with the comments blanked out
//    routeTags         — the <Route> tags of a JSX text
//    appRoutes         — every route of App.jsx, full paths
//    routeTitles       — ROUTE_TITLES and SITE_TITLE
//    pageImports       — the page modules App.jsx imports
//
//  Used by:
//    - core/structural.test.js — every rule
//    - contract/route-sweep.test.jsx — the route table the
//      sweep must cover
// -----------------------------------------------------------

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';


// vitest runs from vite/app (the container's /app)
export const APP_ROOT = process.cwd();
export const SRC = join(APP_ROOT, 'src');







// -----------------------------------------------------------
// readSource / sourceFiles
// -----------------------------------------------------------
//
// readSource reads one file, named by its path under vite/app,
// as text. sourceFiles reads every .js, .jsx and .mjs file
// under a folder — src unless told otherwise — each with its
// path relative to vite/app and its text.
//
// Used by:
//   - appRoutes / routeTitles / pageImports (below)
//   - core/structural.test.js
// -----------------------------------------------------------

export const readSource = (path) => readFileSync(join(APP_ROOT, path), 'utf8');

const walk = (dir) => readdirSync(dir).flatMap((name) => {
  const full = join(dir, name);
  return statSync(full).isDirectory() ? walk(full) : [full];
});

export const sourceFiles = (dir = SRC) => walk(dir)
  .filter((full) => /\.(jsx?|mjs)$/.test(full))
  .map((full) => ({ file: relative(APP_ROOT, full), code: readFileSync(full, 'utf8') }));







// -----------------------------------------------------------
// withoutComments
// -----------------------------------------------------------
//
// Blanks out block and line comments (a "//" right after a
// colon is a URL's, not a comment) — a banner that names a
// call or a route tag must not count as code.
//
// Used by:
//   - appRoutes (below)
//   - core/structural.test.js — the call and import scans
// -----------------------------------------------------------

export const withoutComments = (code) => code
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');







// -----------------------------------------------------------
// routeTags
// -----------------------------------------------------------
//
// Every opening, self-closing and closing <Route> tag of a
// JSX text, in order: an opening tag with its attribute text
// and whether it closes itself, a closing tag as a bare mark.
// An opening tag ends at the first ">" outside braces and
// quotes — a redirect's element attribute, a <Navigate> with
// a quoted target, holds both. A <Routes> tag is never taken
// for one.
//
// Used by:
//   - appRoutes (below)
// -----------------------------------------------------------

function routeTags(jsx) {

  const tags = [];

  for (let i = 0; i < jsx.length; i += 1) {
    if (jsx.startsWith('</Route>', i)) {
      tags.push({ close: true });
      continue;
    }
    if (!jsx.startsWith('<Route', i) || !/[\s/>]/.test(jsx[i + 6])) continue;

    let depth = 0;
    let quote = null;
    let end = i + 6;
    for (; end < jsx.length; end += 1) {
      const c = jsx[end];
      if (quote) {
        if (c === quote) quote = null;
      } else if (c === '"' || c === "'" || c === '`') {
        quote = c;
      } else if (c === '{') {
        depth += 1;
      } else if (c === '}') {
        depth -= 1;
      } else if (c === '>' && depth === 0) {
        break;
      }
    }

    const attrs = jsx.slice(i + 6, end);
    tags.push({ attrs, selfClosing: attrs.trimEnd().endsWith('/') });
    i = end;
  }

  return tags;
}







// -----------------------------------------------------------
// appRoutes
// -----------------------------------------------------------
//
// Every <Route> of App.jsx in declaration order, each with
// its path, whether it is an index route, the component it
// renders and where it redirects to. The path is made
// absolute through its parents (an index route carries its
// parent's path, the root one '/'; the catch-all stays '*').
// The component is the one named in the element attribute —
// null for a layout route that only groups children — and the
// redirect target is a <Navigate>'s, null for every other
// route.
//
// Used by:
//   - core/structural.test.js — titles, pages, families
//   - contract/route-sweep.test.jsx — the sweep's coverage
// -----------------------------------------------------------

export function appRoutes() {

  const tags = routeTags(withoutComments(readSource('src/App.jsx')));
  if (tags.length === 0) throw new Error('no <Route> found in src/App.jsx — has the route table moved?');

  const routes = [];
  const parents = [''];

  for (const tag of tags) {
    if (tag.close) {
      parents.pop();
      continue;
    }

    const parent = parents[parents.length - 1];
    const path = tag.attrs.match(/\bpath="([^"]*)"/)?.[1] ?? null;
    const index = /(^|\s)index(?=[\s/]|$)/.test(tag.attrs);
    const element = tag.attrs.match(/\belement=\{\s*<(\w+)/)?.[1] ?? null;
    if (!index && path === null) throw new Error(`a <Route> with neither path nor index: <Route${tag.attrs}>`);

    const full = index ? (parent || '/') : (path === '*' ? '*' : `${parent}/${path}`);
    routes.push({
      path: full,
      index,
      element,
      redirectTo: element === 'Navigate' ? (tag.attrs.match(/<Navigate\s+to="([^"]*)"/)?.[1] ?? null) : null,
    });

    if (!tag.selfClosing) parents.push(full);
  }

  if (parents.length !== 1) throw new Error('unbalanced <Route> nesting in src/App.jsx');
  return routes;
}







// -----------------------------------------------------------
// routeTitles
// -----------------------------------------------------------
//
// App.jsx's ROUTE_TITLES table as its prefix and title pairs,
// in its order (first match wins there), and the bare
// SITE_TITLE.
//
// Used by:
//   - core/structural.test.js
// -----------------------------------------------------------

export function routeTitles() {

  const app = readSource('src/App.jsx');
  const block = app.match(/const ROUTE_TITLES = \[([\s\S]*?)\n\];/)?.[1];
  const site = app.match(/const SITE_TITLE = "([^"]+)";/)?.[1];
  if (!block || !site) throw new Error('ROUTE_TITLES / SITE_TITLE not found in src/App.jsx');

  const titles = [...block.matchAll(/\['([^']+)',\s*'([^']+)'\]/g)].map(([, prefix, title]) => ({ prefix, title }));
  if (titles.length === 0) throw new Error('ROUTE_TITLES could not be read');

  return { titles, site };
}







// -----------------------------------------------------------
// pageImports
// -----------------------------------------------------------
//
// Every page module App.jsx imports — the name it is imported
// under and its folder in src/pages, read from the default
// imports of a folder's Page module. A static import is the
// only form the one-bundle decision allows (see App.jsx's
// header).
//
// Used by:
//   - core/structural.test.js
// -----------------------------------------------------------

export function pageImports() {
  const app = withoutComments(readSource('src/App.jsx'));
  return [...app.matchAll(/^import (\w+) from '@\/pages\/([^/']+)\/Page';$/gm)].map(([, name, dir]) => ({ name, dir }));
}
