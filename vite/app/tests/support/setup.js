// -----------------------------------------------------------
//  [*] Test support — the vitest setup file
//
//  Runs before every test file (test.setupFiles in
//  vite.config.js):
//
//    - jest-dom matchers (toBeInTheDocument, toBeDisabled, …)
//    - the browser APIs jsdom lacks that MUI and the app's own
//      components touch: ResizeObserver, IntersectionObserver,
//      matchMedia, pointer capture, scrollIntoView / scrollTo,
//      createObjectURL, canvas contexts
//    - the msw backend double (backend/server.js): started once
//      per file, handlers reset after every test, and a request
//      that no handler answers FAILS the test — a page calling
//      an endpoint the double does not know is exactly the kind
//      of drift this suite exists to catch
//    - a clean slate per test: DOM, URL (back to "/"), title,
//      media queries, localStorage, timers, stubbed globals (the
//      wallet doubles) and environment variables (a test's TZ),
//      mocks
//    - a console guard: React's own bug reports (a missing key,
//      a state update on another component while rendering, an
//      unknown DOM prop, a hook-order change) and the app's
//      crash log (ErrorBoundary's "Render failed:") fail the
//      test that caused them; act() warnings are printed but
//      tolerated (an answer landing after the last assertion is
//      not a defect)
//
//  Nothing here reaches a real backend, browser, wallet or the
//  network — the whole suite is self-contained to vite/app.
// -----------------------------------------------------------

import '@testing-library/jest-dom/vitest';
import { afterAll, afterEach, beforeAll, beforeEach, vi } from 'vitest';
import { cleanup, configure } from '@testing-library/react';
import { server, unhandledRequests } from './backend/server';


// Messages console.error may carry that mean the code under
// test has a bug (not a test-timing artefact)
const FATAL_CONSOLE_PATTERNS = [
  /unique "key" prop/,
  /Cannot update a component .* while rendering a different component/,
  /Maximum update depth exceeded/,
  /React does not recognize the .* prop on a DOM element/,
  /Invalid DOM property/,
  /Rendered more hooks than during the previous render/,
  /Rendered fewer hooks than expected/,
  /Invalid hook call/,
  /Objects are not valid as a React child/,
  /Render failed:/,
];







// -----------------------------------------------------------
// Browser API polyfills
// -----------------------------------------------------------
//
// Installed once per file, before any component code runs.
// Each stub is the smallest thing that keeps the library that
// needs it from throwing; tests that care about the real
// behaviour (a media query, a resize, a scroll position)
// override per test.
//
// Used by:
//   - every rendered component, implicitly
// -----------------------------------------------------------

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

class IntersectionObserverStub {
  constructor() { this.root = null; this.rootMargin = ''; this.thresholds = []; }
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() { return []; }
}

// matchMedia: every query reports "does not match" unless a
// test sets one (see mediaQueryMatches) — reset before every
// test
const matchingQueries = new Set();

export function mediaQueryMatches(query, matches = true) {
  if (matches) matchingQueries.add(query); else matchingQueries.delete(query);
}

function matchMediaStub(query) {
  return {
    matches: matchingQueries.has(query),
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() { return false; },
  };
}

// findBy*/waitFor give up after 1 s by default — too little for
// a full page (catalog + a page's queries + MUI) on a loaded
// machine; nothing in the suite is meant to be timing-sensitive
// at that scale
configure({ asyncUtilTimeout: 5000 });

beforeAll(() => {
  globalThis.ResizeObserver ??= ResizeObserverStub;
  globalThis.IntersectionObserver ??= IntersectionObserverStub;
  window.matchMedia = matchMediaStub;
  window.scrollTo = () => {};
  Element.prototype.scrollIntoView ??= function () {};
  Element.prototype.scrollTo ??= function () {};
  Element.prototype.setPointerCapture ??= function () {};
  Element.prototype.releasePointerCapture ??= function () {};
  Element.prototype.hasPointerCapture ??= function () { return false; };
  URL.createObjectURL = () => 'blob:test';
  URL.revokeObjectURL = () => {};
  // The EVM graph (vis-network) and QR codes probe a 2D
  // context; jsdom would log "not implemented" — an inert
  // context is enough
  HTMLCanvasElement.prototype.getContext = () => null;
});







// -----------------------------------------------------------
// Backend double lifecycle
// -----------------------------------------------------------
//
// One msw server per test file: the default handlers (the
// happy path for every endpoint the SPA calls) come back after
// each test, so a test only ever declares the deviation it is
// about. A request no handler matched is recorded by
// backend/server.js and fails the test in afterEach — unless
// the test declared it expects one (allowUnhandledRequests).
//
// Used by:
//   - every test, implicitly
// -----------------------------------------------------------

let unhandledAllowed = false;

export function allowUnhandledRequests() {
  unhandledAllowed = true;
}

// A test that deliberately provokes one of the FATAL console
// messages (the ErrorBoundary tests crash a component on
// purpose) declares the pattern(s) it expects — those lines
// are then not counted against it
const allowedConsoleErrors = [];

export function allowConsoleErrors(...patterns) {
  allowedConsoleErrors.push(...patterns);
}

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'bypass' });
});

afterAll(() => {
  server.close();
});







// -----------------------------------------------------------
// Per-test slate
// -----------------------------------------------------------
//
// Before: the URL back at "/", an empty title, no media query
// matching, the console guard armed. After: React trees
// unmounted, handlers reset, storage wiped, real timers,
// stubbed globals, environment variables and mocks undone
// — then the unhandled-request and console verdicts, which
// come last so the cleanup has happened even when they fail
// the test.
//
// Used by:
//   - every test, implicitly
// -----------------------------------------------------------

const consoleErrors = [];
let originalConsoleError;

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  document.title = '';
  matchingQueries.clear();
  unhandledAllowed = false;
  unhandledRequests.length = 0;
  consoleErrors.length = 0;
  allowedConsoleErrors.length = 0;
  originalConsoleError = console.error;
  console.error = (...args) => {
    consoleErrors.push(args.map((a) => (a instanceof Error ? a.message : String(a))).join(' '));
    originalConsoleError(...args);
  };
});

afterEach(() => {
  cleanup();
  server.resetHandlers();
  localStorage.clear();
  sessionStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  console.error = originalConsoleError;

  if (unhandledRequests.length && !unhandledAllowed) {
    const list = unhandledRequests.map((r) => `${r.method} ${r.url}`).join('\n  ');
    throw new Error(`request(s) the backend double has no handler for — add one in tests/support/backend/handlers.js or answer it in the test:\n  ${list}`);
  }

  const fatal = consoleErrors.filter((msg) =>
    FATAL_CONSOLE_PATTERNS.some((re) => re.test(msg)) && !allowedConsoleErrors.some((re) => re.test(msg)));
  if (fatal.length) {
    throw new Error(`console.error reported a defect during this test:\n  ${fatal.join('\n  ')}`);
  }
});
