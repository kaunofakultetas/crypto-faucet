// -----------------------------------------------------------
//  [*] Test support — the origin and the window.location double
//
//  jsdom's origin is pinned (vitest's default,
//  http://localhost:3000): the SPA's relative "/api/…"
//  requests resolve against it, and the msw handlers listen on
//  it (TEST_ORIGIN).
//
//  Routing needs no double: App.jsx runs its own
//  BrowserRouter, which jsdom supports through the History API
//  — tests set the start path with history.replaceState (see
//  render.jsx renderApp). What jsdom cannot do is a HARD
//  navigation: window.location.reload() logs "Not implemented"
//  and does nothing. The one place the app reloads — the
//  ErrorBoundary card's two buttons — is tested with
//  installLocationDouble(), which swaps the global `location`
//  for a plain object that COUNTS reloads instead.
//
//  Used by:
//    - backend/server.js, backend/handlers.js — TEST_ORIGIN
//    - the ErrorBoundary tests — installLocationDouble
// -----------------------------------------------------------

import { vi } from 'vitest';


export const TEST_ORIGIN = 'http://localhost:3000';







// -----------------------------------------------------------
// installLocationDouble
// -----------------------------------------------------------
//
// Replaces the global `location` (vi.stubGlobal — undone by
// setup.js' vi.unstubAllGlobals after the test) with a double
// at `path`: href / pathname / search / hash read like the
// real thing, reload() is counted in `reloads`, and assigning
// href records the target in `navigations` instead of
// navigating. Meant for components rendered without App's
// BrowserRouter: under renderApp the router reads the double
// too (vitest's jsdom makes document.defaultView the global),
// so install it only AFTER the app has rendered, and do not
// navigate afterwards.
//
// Used by:
//   - the ErrorBoundary tests
// -----------------------------------------------------------

export function installLocationDouble(path = '/') {
  const state = { url: new URL(path, TEST_ORIGIN) };
  const double = {
    navigations: [],
    reloads: 0,
    get href() { return state.url.href; },
    set href(value) {
      double.navigations.push(String(value));
      state.url = new URL(String(value), state.url);
    },
    get origin() { return state.url.origin; },
    get pathname() { return state.url.pathname; },
    get search() { return state.url.search; },
    get hash() { return state.url.hash; },
    assign(value) { double.href = value; },
    replace(value) { double.href = value; },
    reload() { double.reloads += 1; },
    toString() { return state.url.href; },
  };
  vi.stubGlobal('location', double);
  return double;
}
