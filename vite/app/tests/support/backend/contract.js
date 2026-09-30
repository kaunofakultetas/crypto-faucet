// -----------------------------------------------------------
//  [*] Test support — the backend contract matrix
//
//  What a page must survive from its backend. For one endpoint
//  the page consumes, describeEndpointContract() generates a
//  test per response VARIANT — every way the answer can be
//  broken, wrong, late or missing:
//
//    failures (the backend's { error } answers — 500, 400, 404
//    — a proxy's HTML page, a 500 with no body, a dropped
//    connection) — each must reach the screen the way THIS
//    page presents a failure (the `failed` callback: an error
//    card, a notice, a dash …), its own chrome still standing,
//    nothing crashing
//
//    modified bodies (an empty body, null, a string, a number,
//    the wrong container, every field missing, every leaf
//    null, types swapped, extra fields, a huge list, hostile
//    unicode/markup in every string) — the page must not
//    crash: no render error, no error-boundary card, its
//    chrome still there, and markup in a string rendered as
//    text, never as elements
//
//    timing (a hang, a slow answer) — the loading state must
//    hold, then the data must land
//
//  A page test calls it once per endpoint, with the render and
//  the assertions that page understands; the variants a page
//  cannot meet are pinned with `pins` (it.fails, with a short
//  bug description) so the suite stays green while the defect
//  is on record — the convention the backend suite uses for
//  its known bugs.
//
//  Used by:
//    - page tests (tests/pages/*), the route sweep
// -----------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { screen, waitFor, act } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server, url, apiError } from './server';


// What the hostile-string variant puts in every string field
export const HOSTILE_STRING = '💾 Ąžuolas <script>alert(1)</script> <img src=x onerror=alert(2)> {placeholder} \u0000';

// The App's own error-boundary card — a page that threw
export const CRASH_CARD_TEXT = 'Puslapio nepavyko atvaizduoti.';







// -----------------------------------------------------------
// Body mutators
// -----------------------------------------------------------
//
// Pure transforms of a fixture body into a "modified" one.
// They walk arrays and plain objects; leaves are replaced
// according to the variant.
//
// Used by:
//   - VARIANTS (below), tests that build their own variants
// -----------------------------------------------------------

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

const mapLeaves = (value, fn) => {
  if (Array.isArray(value)) return value.map((v) => mapLeaves(v, fn));
  if (isPlainObject(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, mapLeaves(v, fn)]));
  return fn(value);
};

export const nullLeaves = (body) => mapLeaves(body, () => null);

export const swapTypes = (body) => mapLeaves(body, (v) => {
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return v === '' ? 0 : 12345;
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return v;
});

export const hostileStrings = (body) => mapLeaves(body, (v) => (typeof v === 'string' ? HOSTILE_STRING : v));

export const withExtraFields = (body) => {
  const add = (o) => (isPlainObject(o) ? { ...o, extra_field: { deep: [1, 2, { x: null }] }, another: 'unexpected' } : o);
  if (Array.isArray(body)) return body.map(add);
  return add(body);
};

export const missingFields = (body) => (Array.isArray(body) ? body.map(() => ({})) : {});

export const wrongContainer = (body) => (Array.isArray(body) ? {} : []);

// The first list in the body (the body itself, or a field such
// as `transactions` / `days`) grown to n entries
export const hugeList = (body, n = 300) => {
  const grow = (list) => Array.from({ length: n }, (_, i) => {
    const row = list[i % list.length];
    return isPlainObject(row) ? { ...row } : row;
  });
  if (Array.isArray(body)) return body.length ? grow(body) : body;
  if (!isPlainObject(body)) return body;
  const key = Object.keys(body).find((k) => Array.isArray(body[k]) && body[k].length);
  return key ? { ...body, [key]: grow(body[key]) } : body;
};







// -----------------------------------------------------------
// VARIANTS
// -----------------------------------------------------------
//
// Every generated test: { name, respond(fixture) → msw
// response, expect: 'failed' | 'survives' | 'hostile' |
// 'loading' | 'loaded' }.
//
// Used by:
//   - describeEndpointContract (below)
// -----------------------------------------------------------

const jsonResponse = (body, status = 200) => HttpResponse.json(body, { status });

export const VARIANTS = [
  { name: '500 { error } → the failure is shown', respond: () => jsonResponse(apiError('Vidinė serverio klaida'), 500), expect: 'failed' },
  { name: '400 { error } → the failure is shown', respond: () => jsonResponse(apiError('Nepalaikomas tinklas: x'), 400), expect: 'failed' },
  { name: '404 { error } → the failure is shown', respond: () => jsonResponse(apiError('Nerasta'), 404), expect: 'failed' },
  { name: 'HTML error page from the proxy (502) → the failure is shown', respond: () => new HttpResponse('<html><body><h1>502 Bad Gateway</h1></body></html>', { status: 502, headers: { 'Content-Type': 'text/html' } }), expect: 'failed' },
  { name: 'status 500 with an empty body → the failure is shown', respond: () => new HttpResponse(null, { status: 500 }), expect: 'failed' },
  { name: 'connection dropped → the failure is shown', respond: () => HttpResponse.error(), expect: 'failed' },
  { name: 'empty 200 body → page survives', respond: () => new HttpResponse(null, { status: 200 }), expect: 'survives' },
  { name: 'JSON null → page survives', respond: () => jsonResponse(null), expect: 'survives' },
  { name: 'a JSON string → page survives', respond: () => jsonResponse('unexpected'), expect: 'survives' },
  { name: 'a JSON number → page survives', respond: () => jsonResponse(42), expect: 'survives' },
  { name: 'wrong container (object for a list, list for an object) → page survives', respond: (fx) => jsonResponse(wrongContainer(fx)), expect: 'survives' },
  { name: 'every field missing → page survives', respond: (fx) => jsonResponse(missingFields(fx)), expect: 'survives' },
  { name: 'every leaf null → page survives', respond: (fx) => jsonResponse(nullLeaves(fx)), expect: 'survives' },
  { name: 'types swapped (numbers as strings, strings as numbers) → page survives', respond: (fx) => jsonResponse(swapTypes(fx)), expect: 'survives' },
  { name: 'unknown extra fields → page survives and still shows the data', respond: (fx) => jsonResponse(withExtraFields(fx)), expect: 'loaded' },
  { name: 'a huge list (300 entries) → page survives', respond: (fx) => jsonResponse(hugeList(fx)), expect: 'survives' },
  { name: 'hostile strings (unicode + markup) → rendered as text, never as elements', respond: (fx) => jsonResponse(hostileStrings(fx)), expect: 'hostile' },
  { name: 'a hanging request → the loading state holds, nothing crashes', respond: () => new Promise(() => {}), expect: 'loading' },
  { name: 'a slow answer (200 ms) → the data lands', respond: async (fx) => { await new Promise((r) => setTimeout(r, 200)); return jsonResponse(fx); }, expect: 'loaded' },
];







// -----------------------------------------------------------
// describeEndpointContract
// -----------------------------------------------------------
//
// Generates the matrix for one endpoint:
//
//   describeEndpointContract({
//     path: '/api/evm/:network/faucet-balance', // msw path
//     method: 'get',                            // default
//     fixture: f.evmBalance(),                  // the happy body
//     render: () => renderPage(<FaucetEVM />, { route, path }),
//     chrome: () => screen.getByRole('heading', { … }),
//     loaded: async () => { await screen.findByText('41.6') },
//     failed: async () => { await screen.findByText('Nepavyko …') },
//     loading: () => screen.getByText('Kraunama…'),   // optional
//     only: [...names], skip: { name: 'why' },        // optional
//     pins: { name: 'what breaks' },                  // it.fails
//   })
//
// `render` may be async — an endpoint the page calls only
// after a click renders and clicks there, and is awaited.
// `chrome` runs after every variant: the page must still show
// its own frame. `loaded` is awaited for the variants that end
// with data on screen, `failed` for the failure variants (a
// page with no visible failure state passes a callback that
// asserts what it shows instead — say, a dash).
//
// Used by:
//   - page tests
// -----------------------------------------------------------

export function describeEndpointContract({ path, method = 'get', fixture, render, chrome, loaded, failed, loading, only, skip = {}, pins = {} }) {

  const variants = only ? VARIANTS.filter((v) => only.includes(v.name)) : VARIANTS;

  describe(`backend contract — ${method.toUpperCase()} ${path}`, () => {

    for (const variant of variants) {
      if (variant.name in skip) {
        it.skip(`${variant.name} (skipped: ${skip[variant.name]})`, () => {});
        continue;
      }

      const runner = variant.name in pins ? it.fails : it;
      const title = variant.name in pins ? `${variant.name} — PINNED KNOWN BUG: ${pins[variant.name]}` : variant.name;

      runner(title, async () => {
        let answered = false;
        server.use(http[method](url(path), async () => {
          answered = true;
          return variant.respond(structuredClone(fixture));
        }));

        await render();

        if (variant.expect === 'loading') {
          // The request is in flight and stays so: the page must
          // show its loading state (when it has one) and nothing
          // else
          await waitFor(() => expect(answered).toBe(true));
          await settle();
          if (loading) await waitFor(() => expect(loading()).toBeTruthy());
          expectNoCrash();
          if (chrome) expect(chrome()).toBeTruthy();
          return;
        }

        if (variant.expect === 'failed') {
          await waitFor(() => expect(answered).toBe(true));
          await failed();
          expectNoCrash();
          if (chrome) expect(chrome()).toBeTruthy();
          return;
        }

        if (variant.expect === 'loaded') {
          await loaded();
          expectNoCrash();
          if (chrome) expect(chrome()).toBeTruthy();
          return;
        }

        // 'survives' and 'hostile': wait for the answer to be
        // processed, then the page must simply still stand
        await waitFor(() => expect(answered).toBe(true));
        await settle();
        expectNoCrash();
        if (chrome) expect(chrome()).toBeTruthy();
        if (variant.expect === 'hostile') {
          expect(document.querySelector('script')).toBeNull();
          expect(document.querySelector('img[src="x"]')).toBeNull();
        }
      });
    }
  });
}







// -----------------------------------------------------------
// settle / expectNoCrash
// -----------------------------------------------------------
//
// settle() lets React flush the state updates an answered
// request triggers (a few macrotasks inside act, so the updates
// are not reported as un-acted); expectNoCrash() checks that no
// error boundary fired — the test net of renderPage
// (data-testid render-crashed) nor the App's own card
// ("Puslapio nepavyko atvaizduoti.").
//
// Used by:
//   - describeEndpointContract (above), page tests, the route
//     sweep
// -----------------------------------------------------------

export async function settle(ms = 30) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

export function expectNoCrash() {
  const crashed = screen.queryByTestId('render-crashed');
  if (crashed) throw new Error(crashed.textContent);
  expect(screen.queryByText(CRASH_CARD_TEXT)).toBeNull();
}
