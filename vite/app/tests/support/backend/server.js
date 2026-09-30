// -----------------------------------------------------------
//  [*] Test support — the msw backend double
//
//  The SPA never talks to a real backend in this suite. msw
//  (Mock Service Worker, node build) intercepts every request
//  the code under test issues — axios with its relative
//  "/api/…" URLs, exactly as in production — and answers from
//  handlers:
//
//    - handlers.js holds the DEFAULT answer for every endpoint
//      the SPA calls (the happy path, bodies shaped like the
//      real backend's, values from fixtures.js)
//    - a test declares deviations through `given` below (an
//      error answer, a proxy's HTML page, an empty body, a
//      wrong shape, a hang, a dropped connection), which take
//      precedence until setup.js resets the handlers after the
//      test
//    - contract.js turns those deviations into a matrix a
//      page test runs against each endpoint it consumes
//
//  Handlers are registered with ABSOLUTE urls on the jsdom
//  origin (TEST_ORIGIN): jsdom resolves the relative requests
//  against it.
//
//  Used by:
//    - setup.js — lifecycle, the unhandled-request verdict
//    - every test that shapes a backend answer (given.*)
// -----------------------------------------------------------

import { http, HttpResponse, delay } from 'msw';
import { setupServer } from 'msw/node';
import { defaultHandlers } from './handlers';
import { TEST_ORIGIN } from '../location';


// Requests no handler answered during the current test —
// setup.js fails the test on them (see allowUnhandledRequests)
export const unhandledRequests = [];


export const server = setupServer(...defaultHandlers);

server.events.on('request:unhandled', ({ request }) => {
  unhandledRequests.push({ method: request.method, url: request.url });
});







// -----------------------------------------------------------
// url
// -----------------------------------------------------------
//
// "/api/evm/networks" → "http://localhost:3000/api/evm/networks".
// Paths may carry msw params (":network") and wildcards ("*");
// an absolute URL is returned unchanged.
//
// Used by:
//   - handlers.js, given (below), contract.js
// -----------------------------------------------------------

export const url = (path) => (/^https?:\/\//.test(path) ? path : `${TEST_ORIGIN}${path}`);







// -----------------------------------------------------------
// apiError
// -----------------------------------------------------------
//
// The body of every backend failure: { error: "<message>" } —
// a Lithuanian sentence the pages show as it is (the faucets'
// cooldown, an empty faucet, an unknown network …).
//
// Used by:
//   - handlers.js, given.error, contract.js
// -----------------------------------------------------------

export const apiError = (message) => ({ error: message });







// -----------------------------------------------------------
// given
// -----------------------------------------------------------
//
// One-liners that override the answer of a single endpoint
// for the rest of the test. `method` is 'get' | 'post';
// `path` is an "/api/…" path with optional msw params. Every
// override goes through server.use and so is dropped by the
// handler reset in setup.js afterEach.
//
//   given.json('get', '/api/evm/networks', {})         — any body, 200
//   given.json('get', '/api/evm/networks', {}, { status: 500 })
//   given.error('get', '/api/evm/:network/request', 'Palaukite', 429)
//   given.html('get', '/api/evm/networks')             — a proxy's HTML 502
//   given.text('get', '/api/evm/networks', 'oops')     — text/plain 200
//   given.empty('get', '/api/evm/networks')            — 200, no body
//   given.networkError('get', '/api/evm/networks')     — connection failed
//   given.hang('get', '/api/evm/networks')             — never answers
//   given.slow('get', '/api/evm/networks', 300, body)  — answers after ms
//   const calls = given.capture('get', '/api/evm/:network/request', body)
//     → calls[i] = { url, params, query, body } for every request
//       that arrived (query: the URL's search params as an
//       object; body: the parsed JSON or text a POST carried,
//       else null). `body` may be a function of
//       ({ params, query }) returning the answer's body — or a
//       whole response (HttpResponse.json(…, { status: 503 }))
//   given.sequence('get', '/api/x', [r1, r2])          — one per call,
//     the last repeats; r = { status?, body?, error?, html? }
//
// Used by:
//   - page and component tests, contract.js
// -----------------------------------------------------------

const respond = (method, path, resolver) => {
  server.use(http[method](url(path), resolver));
};

export const given = {

  json(method, path, body, { status = 200 } = {}) {
    respond(method, path, () => HttpResponse.json(body, { status }));
  },

  error(method, path, message, status = 400) {
    respond(method, path, () => HttpResponse.json(apiError(message), { status }));
  },

  html(method, path, status = 502, text = '<html><body><h1>502 Bad Gateway</h1></body></html>') {
    respond(method, path, () => new HttpResponse(text, { status, headers: { 'Content-Type': 'text/html' } }));
  },

  text(method, path, text, status = 200) {
    respond(method, path, () => new HttpResponse(text, { status, headers: { 'Content-Type': 'text/plain' } }));
  },

  empty(method, path, status = 200) {
    respond(method, path, () => new HttpResponse(null, { status }));
  },

  networkError(method, path) {
    respond(method, path, () => HttpResponse.error());
  },

  hang(method, path) {
    respond(method, path, () => new Promise(() => {}));
  },

  slow(method, path, ms, body = {}, { status = 200 } = {}) {
    respond(method, path, async () => {
      await delay(ms);
      return HttpResponse.json(body, { status });
    });
  },

  capture(method, path, body = {}, { status = 200 } = {}) {
    const calls = [];
    respond(method, path, async ({ request, params }) => {
      const requested = new URL(request.url);
      const text = await request.text();
      let sent = null;
      if (text) {
        try { sent = JSON.parse(text); } catch { sent = text; }
      }
      calls.push({ url: request.url, params: { ...params }, query: Object.fromEntries(requested.searchParams), body: sent });
      const answer = typeof body === 'function' ? body({ params, query: requested.searchParams }) : body;
      return answer instanceof Response ? answer : HttpResponse.json(answer, { status });
    });
    return calls;
  },

  sequence(method, path, responses) {
    let i = 0;
    respond(method, path, () => {
      const step = responses[Math.min(i, responses.length - 1)];
      i += 1;
      if (step.error) return HttpResponse.error();
      if (step.html) return new HttpResponse(step.html, { status: step.status ?? 502, headers: { 'Content-Type': 'text/html' } });
      return HttpResponse.json(step.body ?? {}, { status: step.status ?? 200 });
    });
  },
};
