// -----------------------------------------------------------
//  [*] Tests — structural rules of the SPA
//
//  Rules about the code base as a whole rather than one
//  component, read from the source text:
//    - every backend call in src/ (axios.<method>, fetch —
//      literal and template URLs, a URL on the next line) has
//      a default handler in the test double, every one is a
//      relative /api path, and the only non-literal URLs are
//      the SVM and MOVE pages' POSTs to the network's public
//      RPC (rpc_urls[0] of the payload), which the double
//      answers for every fixture network; nothing else talks
//      to the network
//    - the route table: every page route titled by
//      ROUTE_TITLES, its FIRST matching prefix the most
//      specific one, no dead or duplicate titles; every page
//      directory statically imported and routed; no lazy or
//      dynamic import anywhere (the one-bundle decision in
//      App.jsx's header); every redirect a replace to "/";
//      every family of FAUCET_TYPES routed under /faucet, and
//      nothing else there; no path prefix a routed page sits
//      under swallowed by a sibling's :param
//    - index.html: Lithuanian, titled like App.jsx's bare
//      SITE_TITLE
//    - the SPA persists only through localStorage, and
//      ErrorBoundary's "clear remembered data" covers every
//      key it writes
//    - the double's catalog carries exactly the families of
//      FAUCET_TYPES
//
//  Pinned: the prefix /graph/utxo is swallowed by
//  /graph/:network (see core/app.test.jsx); ErrorBoundary's
//  list misses the UTXO graph's saved positions
//  (utxo-graph-positions:).
// -----------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { defaultHandlers } from '../support/backend/handlers';
import * as f from '../support/backend/fixtures';
import { SRC, appRoutes, pageImports, readSource, routeTitles, sourceFiles, withoutComments } from '../support/shell/source';
import { FAUCET_TYPES } from '@/components/Navbar';


// The code of every source file, comments blanked out
const CODE = sourceFiles().map(({ file, code }) => ({ file, code: withoutComments(code) }));

// The page routes: a component, not a redirect or a layout
const PAGE_ROUTES = appRoutes().filter((route) => route.element && route.element !== 'Navigate' && !route.index && route.path !== '*');

// A route pattern made concrete: every :param becomes "x"
const samplePath = (path) => path.replace(/:\w+/g, 'x');







// -----------------------------------------------------------
// callArguments
// -----------------------------------------------------------
//
// The argument list of the call whose "(" sits at `open`, as
// top-level arguments — strings, templates and nested
// brackets respected.
// -----------------------------------------------------------

function callArguments(code, open) {

  const args = [];
  let depth = 0;
  let quote = null;
  let start = open + 1;

  for (let i = open; i < code.length; i += 1) {
    const c = code[i];
    if (quote) {
      if (c === '\\') i += 1;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') quote = c;
    else if ('([{'.includes(c)) depth += 1;
    else if (')]}'.includes(c)) {
      depth -= 1;
      if (depth === 0) {
        args.push(code.slice(start, i).trim());
        return args.filter(Boolean);
      }
    } else if (c === ',' && depth === 1) {
      args.push(code.slice(start, i).trim());
      start = i + 1;
    }
  }
  throw new Error(`unclosed call at ${open}`);
}







// -----------------------------------------------------------
// networkCalls
// -----------------------------------------------------------
//
// Every axios call and every fetch in src/, each with its
// file, its HTTP method (GET unless the call names another)
// and its URL: a literal or template URL becomes its path,
// with template expressions turned into ":param" and the
// query string dropped; any other URL is kept as the
// expression it comes from.
// -----------------------------------------------------------

const CALL_RE = /\baxios\.(get|post|put|patch|delete|head|options)\(|(?<![\w.$])fetch\(/g;

function networkCalls() {

  const calls = [];

  for (const { file, code } of CODE) {
    for (const match of code.matchAll(CALL_RE)) {
      const args = callArguments(code, match.index + match[0].length - 1);
      const first = args[0] ?? '';
      const method = (match[1] ?? args[1]?.match(/method:\s*['"`](\w+)['"`]/)?.[1] ?? 'get').toUpperCase();
      const literal = first.match(/^(?:"([^"]*)"|'([^']*)'|`([^`]*)`)$/);

      if (literal) {
        const raw = literal[1] ?? literal[2] ?? literal[3];
        calls.push({ file, method, url: raw.replace(/\$\{[^}]*\}/g, ':param').split('?')[0] });
      } else {
        calls.push({ file, method, expression: first });
      }
    }
  }

  return calls;
}

// A handler's path (absolute, msw params) against a call's
// path: segment-wise, a ":param" on either side matching
// anything
const handlerMatches = (handler, method, url) => {
  if (handler.info.method.toUpperCase() !== method) return false;
  const handlerPath = String(handler.info.path).replace(/^http:\/\/localhost:3000/, '');
  const hs = handlerPath.split('/');
  const cs = url.split('/');
  if (hs.length !== cs.length) return false;
  return hs.every((segment, i) => segment.startsWith(':') || cs[i].startsWith(':') || segment === cs[i]);
};

// The calls whose URL is not a literal: the SVM and MOVE pages
// POST the student's balance query straight to the network's
// PUBLIC endpoint, rpc_urls[0] of the network payload — the
// double must answer each fixture network's
const PUBLIC_RPC_READERS = {
  'src/pages/Faucet_SVM/Page.jsx': f.svmNetworksMap,
  'src/pages/Faucet_MOVE/Page.jsx': f.moveNetworksMap,
};







// -----------------------------------------------------------
// storageKeyPrefixes
// -----------------------------------------------------------
//
// The key of every localStorage.setItem call in src/, resolved
// to the literal it starts with: a string, a template's head,
// a constant (in the file — or, for a key read off a table,
// that table's entry anywhere in src/), the left side of a
// "+", or — for a function parameter — the literal first
// arguments of that function's calls. An unreadable key
// throws, so a new kind of writer fails the rule loudly
// instead of slipping past it.
// -----------------------------------------------------------

function resolveKey(expression, file, code) {

  const expr = expression.trim();

  const quoted = expr.match(/^(?:"([^"]*)"|'([^']*)')$/);
  if (quoted) return [quoted[1] ?? quoted[2]];

  const template = expr.match(/^`([^`]*)`$/);
  if (template) {
    const leading = template[1].match(/^\$\{([^}]+)\}/);
    return leading ? resolveKey(leading[1], file, code) : [template[1].split('${')[0]];
  }

  const sum = expr.match(/^([\w$.]+)\s*\+/);
  if (sum) return resolveKey(sum[1], file, code);

  const dotted = expr.match(/^[\w$]+\.([\w$]+)$/);
  if (dotted) {
    for (const other of CODE) {
      const entry = other.code.match(new RegExp(`\\b${dotted[1]}:\\s*'([^']*)'`));
      if (entry) return [entry[1]];
    }
  }

  if (/^[\w$]+$/.test(expr)) {
    const constant = code.match(new RegExp(`const ${expr} = ([^;]+);`));
    if (constant) return resolveKey(constant[1], file, code);

    // A parameter: the literal first argument of every call
    const owner = code.match(new RegExp(`function (\\w+)\\(\\s*${expr}\\b`));
    if (owner) {
      const literals = CODE.flatMap((other) => [...other.code.matchAll(new RegExp(`\\b${owner[1]}\\(\\s*'([^']*)'`, 'g'))].map((m) => m[1]));
      if (literals.length) return literals;
    }
  }

  throw new Error(`cannot read the localStorage key "${expr}" in ${file}`);
}

function storageKeyPrefixes() {
  return CODE.flatMap(({ file, code }) => [...code.matchAll(/\blocalStorage\.setItem\(/g)].flatMap((match) => {
    const [key] = callArguments(code, match.index + match[0].length - 1);
    return resolveKey(key, file, code);
  }));
}

// ErrorBoundary.jsx's CACHE_KEY_PREFIXES, read from its source
const clearedPrefixes = () => {
  const list = readSource('src/components/ErrorBoundary.jsx').match(/const CACHE_KEY_PREFIXES = \[([^\]]*)\]/)?.[1];
  if (!list) throw new Error('CACHE_KEY_PREFIXES not found in ErrorBoundary.jsx');
  return [...list.matchAll(/'([^']*)'/g)].map((m) => m[1]);
};







// -----------------------------------------------------------
// The backend calls
// -----------------------------------------------------------

describe('structural rules — the backend calls', () => {

  const calls = networkCalls();


  it('finds the SPA\'s calls — every page\'s and the navbar\'s', () => {
    expect(calls.length).toBeGreaterThanOrEqual(25);
    const files = new Set(calls.map((call) => call.file));
    for (const file of ['src/components/Navbar.jsx', 'src/pages/Faucet_EVM/Page.jsx', 'src/pages/Graph/Page.jsx', 'src/pages/Graph/hooks/useTransactionGraph.js', 'src/pages/Graph_UTXO/hooks/useTransactionGraph.js', 'src/pages/BlockchainSimulator/Page.jsx']) {
      expect(files, file).toContain(file);
    }
    // the transaction-days call, whose URL starts on the next line
    expect(calls).toContainEqual({ file: 'src/pages/Graph/Page.jsx', method: 'GET', url: '/api/evm/:param/transaction-days' });
    // the rename, a fetch whose URL starts on the next line
    expect(calls).toContainEqual({ file: 'src/pages/Graph/hooks/useTransactionGraph.js', method: 'GET', url: '/api/evm/set-address-name' });
  });


  it('every backend call in src/ has a default handler in the test double', () => {
    const unhandled = calls
      .filter((call) => call.url && !defaultHandlers.some((handler) => handlerMatches(handler, call.method, call.url)))
      .map((call) => `${call.method} ${call.url} (${call.file})`);
    expect(unhandled).toEqual([]);
  });


  it('every literal URL is a relative /api path — no hardcoded host', () => {
    const elsewhere = calls.filter((call) => call.url && !call.url.startsWith('/api/')).map((call) => `${call.url} (${call.file})`);
    expect(elsewhere).toEqual([]);
  });


  it('the only non-literal URLs are the public RPC reads, and the double answers every fixture network\'s', () => {
    const computed = calls.filter((call) => call.expression);
    expect(computed.map(({ file, method }) => `${method} ${file}`).sort()).toEqual([
      'POST src/pages/Faucet_MOVE/Page.jsx',
      'POST src/pages/Faucet_SVM/Page.jsx',
    ]);

    for (const [file, networks] of Object.entries(PUBLIC_RPC_READERS)) {
      expect(readSource(file), file).toMatch(/const clusterRpc = networkInfo\?\.rpc_urls\?\.\[0\]|rpc_urls\?\.\[0\]/);
      for (const [key, network] of Object.entries(networks)) {
        const endpoint = network.rpc_urls[0];
        expect(defaultHandlers.some((handler) => handler.info.method === 'POST' && handler.info.path === endpoint), `${key}: POST ${endpoint}`).toBe(true);
      }
    }
  });


  it('nothing else talks to the network — no XMLHttpRequest, WebSocket, EventSource, beacon or bare axios call', () => {
    const offenders = CODE.filter(({ code }) => (
      /\bnew\s+(XMLHttpRequest|WebSocket|EventSource)\b|\bsendBeacon\(|\baxios\(|\baxios\.(create|request)\(/.test(code)
    )).map(({ file }) => file);
    expect(offenders).toEqual([]);
  });
});







// -----------------------------------------------------------
// The route table
// -----------------------------------------------------------

describe('structural rules — the route table', () => {

  const { titles, site } = routeTitles();


  it('reads App.jsx\'s routes', () => {
    expect(PAGE_ROUTES.map((route) => route.path)).toEqual([
      '/faucet/evm/:network', '/faucet/svm/:network', '/faucet/move/:network', '/faucet/erc20/:token', '/faucet/utxo/:network',
      '/graph/:network', '/graph/utxo/:network',
      '/sha256', '/presentations', '/dapps-server',
    ]);
    expect(appRoutes().find((route) => route.path === '*')?.element).toBe('NotFoundPage');
    expect(appRoutes().find((route) => route.path === '/' && route.index)?.element).toBe('DynamicDefaultRedirect');
  });


  it('titles every page route, its first matching prefix being the most specific one', () => {
    for (const route of PAGE_ROUTES) {
      const path = samplePath(route.path);
      const matching = titles.filter(({ prefix }) => path.startsWith(prefix));
      expect(matching.length, `${route.path} has a ROUTE_TITLES entry`).toBeGreaterThan(0);
      const longest = [...matching].sort((a, b) => b.prefix.length - a.prefix.length)[0];
      expect(matching[0], `${route.path} is titled by its most specific prefix`).toEqual(longest);
    }
  });


  it('lists a longer prefix before every shorter one it extends', () => {
    titles.forEach(({ prefix }, i) => {
      titles.slice(0, i).forEach((earlier) => {
        expect(prefix.startsWith(earlier.prefix), `${prefix} is shadowed by the earlier ${earlier.prefix}`).toBe(false);
      });
    });
  });


  it('has no dead or duplicate titles: each prefix leads to a page, each name is its own', () => {
    for (const { prefix } of titles) {
      expect(PAGE_ROUTES.some((route) => samplePath(route.path).startsWith(prefix)), prefix).toBe(true);
    }
    expect(new Set(titles.map(({ title }) => title)).size).toBe(titles.length);
    expect(new Set(titles.map(({ prefix }) => prefix)).size).toBe(titles.length);
    expect(site).toBe("VU KNF Faucet'as");
  });


  it('imports every page directory under src/pages statically, and routes it', () => {
    const directories = readdirSync(join(SRC, 'pages')).filter((name) => statSync(join(SRC, 'pages', name)).isDirectory());
    const imports = pageImports();
    const routed = new Set(appRoutes().map((route) => route.element));

    for (const directory of directories) {
      expect(existsSync(join(SRC, 'pages', directory, 'Page.jsx')), `${directory}/Page.jsx`).toBe(true);
      const imported = imports.filter((entry) => entry.dir === directory);
      expect(imported, `${directory} imported once by App.jsx`).toHaveLength(1);
      expect(routed.has(imported[0].name), `${directory} (${imported[0].name}) is a route's element`).toBe(true);
    }
    expect(imports).toHaveLength(directories.length);
  });


  it('every page module default-exports its component', () => {
    for (const { dir } of pageImports()) {
      expect(readSource(`src/pages/${dir}/Page.jsx`), dir).toMatch(/^export default function \w+\(/m);
    }
  });


  it('has no lazy or dynamic import anywhere — one bundle, by decision', () => {
    const offenders = CODE.filter(({ code }) => /\bimport\s*\(|\blazy\s*\(/.test(code)).map(({ file }) => file);
    expect(offenders).toEqual([]);
    expect(readSource('src/App.jsx')).toMatch(/one bundle, no lazy chunks/);
  });


  it('every redirect replaces the history entry, and every index redirect goes to "/"', () => {
    const app = withoutComments(readSource('src/App.jsx'));
    const navigates = [...app.matchAll(/<Navigate\b[^>]*\/>/g)].map(([tag]) => tag);
    expect(navigates.length).toBeGreaterThan(0);
    for (const tag of navigates) expect(tag, tag).toMatch(/\sreplace(\s|\/)/);

    const indexRedirects = appRoutes().filter((route) => route.index && route.element === 'Navigate');
    expect(indexRedirects.map((route) => route.path)).toEqual(['/faucet', '/faucet/evm', '/faucet/svm', '/faucet/move', '/faucet/erc20', '/faucet/utxo', '/graph', '/graph/utxo']);
    for (const route of indexRedirects) expect(route.redirectTo, route.path).toBe('/');
  });


  it('routes every family of FAUCET_TYPES under /faucet — a redirecting index and a keyed page — and nothing else there', () => {
    const routes = appRoutes();
    for (const { key } of FAUCET_TYPES) {
      expect(routes.some((route) => route.index && route.path === `/faucet/${key}` && route.redirectTo === '/'), `/faucet/${key} index`).toBe(true);
      expect(PAGE_ROUTES.some((route) => new RegExp(`^/faucet/${key}/:\\w+$`).test(route.path)), `/faucet/${key}/:key`).toBe(true);
    }
    const families = new Set(routes.map((route) => route.path.match(/^\/faucet\/([^/]+)/)?.[1]).filter(Boolean));
    expect([...families].sort()).toEqual(FAUCET_TYPES.map(({ key }) => key).sort());
  });


  it('no path prefix of a routed page is swallowed by a sibling\'s :param — typed on its own it redirects or is not found', () => {
    const routes = appRoutes();
    const patternOf = (path) => new RegExp(`^${path.replace(/:\w+/g, '[^/]+')}$`);

    // Every shorter prefix of a page route that holds only
    // static segments — it stops before the first :param
    const prefixes = new Set();
    for (const route of PAGE_ROUTES) {
      const segments = route.path.split('/').filter(Boolean);
      for (let depth = 1; depth < segments.length && !segments[depth - 1].startsWith(':'); depth += 1) {
        prefixes.add(`/${segments.slice(0, depth).join('/')}`);
      }
    }

    const swallowed = [...prefixes].filter((prefix) => (
      !routes.some((candidate) => candidate.index && candidate.path === prefix)
      && PAGE_ROUTES.some((page) => patternOf(page.path).test(prefix))
    ));
    expect(swallowed).toEqual([]);
  });
});







// -----------------------------------------------------------
// index.html
// -----------------------------------------------------------

describe('structural rules — index.html', () => {

  it('declares the page Lithuanian and titles it like App.jsx\'s bare site name', () => {
    const html = readSource('index.html');
    expect(html).toMatch(/<html lang="lt">/);
    expect(html.match(/<title>([^<]*)<\/title>/)?.[1]).toBe(routeTitles().site);
  });
});







// -----------------------------------------------------------
// What the SPA remembers
// -----------------------------------------------------------

describe('structural rules — what the SPA remembers', () => {

  it('persists only through localStorage — no sessionStorage, cookie, IndexedDB or Cache API', () => {
    const offenders = CODE.filter(({ code }) => /\bsessionStorage\b|document\.cookie|\bindexedDB\b|\bcaches\./.test(code)).map(({ file }) => file);
    expect(offenders).toEqual([]);
  });


  it('writes these keys: the catalog, the last picks, the favourites, and both graphs\' positions', () => {
    expect([...new Set(storageKeyPrefixes())].sort()).toEqual([
      'catalog:v2', 'favFaucetPicks', 'graphNodePositions:', 'lastPick:', 'utxo-graph-positions:',
    ]);
  });


  it('ErrorBoundary\'s "clear remembered data" covers every key the SPA writes', () => {
    const cleared = clearedPrefixes();
    const uncovered = [...new Set(storageKeyPrefixes())].filter((key) => !cleared.some((prefix) => key.startsWith(prefix)));
    expect(uncovered).toEqual([]);
  });
});







// -----------------------------------------------------------
// The double and the navbar agree
// -----------------------------------------------------------

describe('structural rules — the double\'s catalog', () => {

  it('carries exactly the families of FAUCET_TYPES, each with entries and a default that exists', () => {
    expect(Object.keys(f.catalog).sort()).toEqual(FAUCET_TYPES.map(({ key }) => key).sort());
    for (const type of FAUCET_TYPES) {
      const keys = type.itemsOf(f.catalog[type.key]).map((item) => item.key);
      expect(keys.length, type.key).toBeGreaterThan(0);
      expect(keys, type.key).toContain(type.defaultOf(f.catalog[type.key]));
    }
  });
});
