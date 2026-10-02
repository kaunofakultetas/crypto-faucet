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
// An "/api/…" path made absolute on the jsdom origin
// (TEST_ORIGIN), where the handlers listen. The path may carry
// msw params and wildcards; a URL that is already absolute is
// returned unchanged.
//
// Used by:
//   - given (below), contract.js, shell/requests.js,
//     graph-evm/backend.js
//   - the faucet page tests — handlers of their own, and the
//     URLs some of them assert on
// -----------------------------------------------------------

export const url = (path) => (/^https?:\/\//.test(path) ? path : `${TEST_ORIGIN}${path}`);







// -----------------------------------------------------------
// apiError
// -----------------------------------------------------------
//
// The body of every backend failure: an object whose error
// field holds a Lithuanian sentence the pages show as it is
// (the faucets' cooldown, an empty faucet, an unknown
// network …).
//
// Used by:
//   - given.error (below), contract.js — the failure variants
//   - graph-evm/backend.js — its outages and refusals
//   - contract/route-sweep.test.jsx — the 500 mode
// -----------------------------------------------------------

export const apiError = (message) => ({ error: message });







// -----------------------------------------------------------
// given
// -----------------------------------------------------------
//
// One-liners that override the answer of a single endpoint
// for the rest of the test. Each takes the HTTP method (get or
// post) and an "/api/…" path, msw params allowed. Every
// override goes through server.use and so is dropped by the
// handler reset in setup.js afterEach.
//
// json answers any body, with status 200 unless the test
// names another; error answers the backend's own failure body
// carrying the test's message, a 400 unless told otherwise;
// html is a proxy's HTML error page, a 502 Bad Gateway unless
// the test gives its own status and page; text is a
// text/plain body and empty an answer with no body at all,
// both 200 unless told otherwise; networkError is a dropped
// connection, hang a request that never answers, and slow
// answers the body only after the given number of
// milliseconds.
//
// capture answers with a body and hands back the list of
// every request that arrived — its URL, its path params, its
// query (the URL's search params as an object) and its body
// (the parsed JSON or text a POST carried, else null). The
// body may also be a function of the request's path params
// and query (here the search params as they are) that returns
// the answer's body; the body, or what the function returns,
// may be a whole msw response the test built itself.
//
// sequence answers each call with the next response of a
// list, the last one repeating: a dropped connection, an HTML
// page (a 502 unless it names a status) or a JSON body (an
// empty object with status 200 unless it gives others).
//
// Used by:
//   - page, component and core tests
//   - graph-utxo/graph.jsx — answerGraph
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
