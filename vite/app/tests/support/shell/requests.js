// -----------------------------------------------------------
//  [*] Test support — watching and bending every request
//
//  Two server-wide views on top of backend/server.js, for the
//  tests that care about ALL of a page's requests rather than
//  one endpoint:
//
//    watchRequests — records every request under a path and
//                    lets it through to the handler that
//                    answers it (an msw resolver returning
//                    nothing falls through)
//    everyGet      — answers every /api GET with one response
//                    (a 500, a JSON string, a dropped
//                    connection …), counting the GETs made and
//                    answered
//    backendIdle   — waits until every GET everyGet counted
//                    has been answered and rendered
//
//  Both go through server.use, so setup.js' handler reset
//  drops them after the test.
//
//  Used by:
//    - contract/route-sweep.test.jsx — the failure modes
//    - core/app.test.jsx, pages/not-found.test.jsx — which
//      requests a route makes
// -----------------------------------------------------------

import { http } from 'msw';
import { server, url } from '../backend/server';
import { settle } from '../backend/contract';







// -----------------------------------------------------------
// watchRequests
// -----------------------------------------------------------
//
//   const seen = watchRequests()          — every /api request
//   const seen = watchRequests('/api/evm/*')
//   seen → ['GET /api/faucet/catalog', …] (path, no query)
//
// Used by:
//   - core/app.test.jsx, pages/not-found.test.jsx
// -----------------------------------------------------------

export function watchRequests(pattern = '/api/*') {
  const seen = [];
  server.use(http.all(url(pattern), ({ request }) => {
    seen.push(`${request.method} ${new URL(request.url).pathname}`);
  }));
  return seen;
}







// -----------------------------------------------------------
// everyGet
// -----------------------------------------------------------
//
//   const gets = everyGet(() => HttpResponse.error())
//   gets → { count, answered, paths: [...] }
//
// `respond(request)` may be async; a response that never
// comes (a hang) simply never counts as answered.
//
// Used by:
//   - contract/route-sweep.test.jsx
// -----------------------------------------------------------

export function everyGet(respond) {
  const gets = { count: 0, answered: 0, paths: [] };
  server.use(http.get(url('/api/*'), async ({ request }) => {
    gets.count += 1;
    gets.paths.push(new URL(request.url).pathname);
    const response = await respond(request);
    gets.answered += 1;
    return response;
  }));
  return gets;
}







// -----------------------------------------------------------
// backendIdle
// -----------------------------------------------------------
//
// Settles until every GET issued so far has been answered and
// no new one appeared over a settle window — the answers have
// landed and React has rendered their outcome. A page that
// fetched nothing just gets the settles. Gives up quietly
// after `limit` ms (a poll that keeps firing); the assertions
// that follow decide.
//
// Used by:
//   - contract/route-sweep.test.jsx
// -----------------------------------------------------------

export async function backendIdle(gets, limit = 6000) {
  const deadline = Date.now() + limit;
  let seen = -1;
  while (Date.now() < deadline) {
    await settle(150);
    if (gets.answered === gets.count && gets.count === seen) return;
    seen = gets.count;
  }
}
