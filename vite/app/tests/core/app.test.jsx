// -----------------------------------------------------------
//  [*] Tests — App.jsx (the shell, "/" and routing, the titles)
//
//  The whole application through renderApp — App.jsx's own
//  BrowserRouter, started at a route:
//    - the shell: the skip link first, the navbar, the page
//      as the main landmark (focusable, the skip link's
//      target), the footer — and the same shell booting and
//      navigating under StrictMode, as main.jsx mounts it
//    - "/": decided on the catalog, never on a fetch in flight
//      — EVM preferred, faucetTargetFor's pick (last used →
//      backend default → first entry), a disabled family
//      skipped in navbar order, nothing configured rendering
//      nothing, a replace (Back never bounces), one catalog
//      request shared with the navbar, a remembered catalog
//      deciding while the fetch is out or failed
//    - CatalogUnavailable: the catalog failed with nothing
//      remembered — the notice, the retry (its own and the
//      navbar's), the teaching pages that need no backend
//    - the family index redirects, an unknown family
//    - document.title: the route family's name, re-titled on
//      client-side navigation and Back, the longer prefix
//      winning, the bare site name elsewhere
//    - the two error boundaries: the navbar's (a remembered
//      catalog it cannot read — its card stays until a
//      reload) and the page area's (a page that throws — the
//      DAPPS launcher, wrapped with a switch below — reset by
//      leaving the route)
//  and the backend contract of GET /api/faucet/catalog as "/"
//  consumes it. (The route sweep titles and renders every
//  route; the not-found page has its own file.)
//
//  Pinned: /graph/utxo (the UTXO graph without a network)
//  renders the EVM graph for a network named "utxo" instead of
//  redirecting like every other family index; a path that
//  merely begins with a route's letters (/graphs) is titled as
//  that route.
// -----------------------------------------------------------

import { describe, it, expect, vi, afterEach } from 'vitest';
import { StrictMode } from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { renderApp, makeQueryClient } from '../support/render';
import { given } from '../support/backend/server';
import { allowConsoleErrors } from '../support/setup';
import { CRASH_CARD_TEXT, describeEndpointContract, settle } from '../support/backend/contract';
import { goBack, navigateTo } from '../support/shell/router';
import { watchRequests } from '../support/shell/requests';
import { CATALOG_CACHE_KEY, catalogWith, catalogWithout, rememberCatalog, rememberPick } from '../support/shell/catalog';
import * as f from '../support/backend/fixtures';
import App from '@/App';


// The page area's boundary needs a page that throws on
// demand: the DAPPS launcher, wrapped — the real page unless
// a test flips the switch (reset after every test)
const crash = vi.hoisted(() => ({ page: false }));

vi.mock('@/pages/DappsServer/Page', async (importOriginal) => {
  const { default: DappsServerPage } = await importOriginal();
  return {
    default: function DappsServerOrCrash() {
      if (crash.page) throw new Error('sugedo puslapis');
      return <DappsServerPage />;
    },
  };
});

afterEach(() => {
  crash.page = false;
});


const SITE = "VU KNF Faucet'as";
const UNAVAILABLE = "Faucet'ų sąrašas nepasiekiamas. Serveris gali būti perkraunamas.";

const main = () => screen.getByRole('main');
const navbar = () => screen.getByRole('navigation');

const landsOn = async (path) => {
  await waitFor(() => expect(window.location.pathname).toBe(path));
};

const titled = async (title) => {
  await waitFor(() => expect(document.title).toBe(title));
};

// DOM order is reading order: a before b
const precedes = (a, b) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

// A remembered catalog the navbar cannot read — a network
// entry that is null (it reads network.full_name)
const UNREADABLE_CATALOG = { evm: { default_network: 'sepolia', networks: { sepolia: null } } };







// -----------------------------------------------------------
// The shell
// -----------------------------------------------------------

describe('App shell', () => {

  it('frames the page: the skip link, the navigation, the page as the main landmark, the footer — in that order', async () => {
    renderApp({ route: '/presentations' });
    expect(await within(main()).findByRole('heading', { level: 1, name: 'Prezentacijos' })).toBeInTheDocument();

    const skip = screen.getByRole('link', { name: 'Pereiti prie turinio' });
    expect(precedes(skip, navbar())).toBe(true);
    expect(precedes(navbar(), main())).toBe(true);
    expect(precedes(main(), screen.getByRole('contentinfo'))).toBe(true);
    expect(screen.getAllByRole('navigation')).toHaveLength(1);
    expect(screen.getAllByRole('main')).toHaveLength(1);
  });


  it('the skip link jumps past the navbar: it targets #main, which can take the focus', async () => {
    renderApp({ route: '/presentations' });
    expect(screen.getByRole('link', { name: 'Pereiti prie turinio' })).toHaveAttribute('href', '#main');
    expect(main()).toHaveAttribute('id', 'main');
    expect(main()).toHaveAttribute('tabindex', '-1');
    act(() => main().focus());
    expect(main()).toHaveFocus();
  });


  it('the skip link is the keyboard\'s first stop', async () => {
    const { user } = renderApp({ route: '/presentations' });
    await user.tab();
    expect(screen.getByRole('link', { name: 'Pereiti prie turinio' })).toHaveFocus();
  });


  it('following the skip link only adds the fragment — the page stays as it was', async () => {
    const { user } = renderApp({ route: '/presentations' });
    await within(main()).findByRole('heading', { level: 1, name: 'Prezentacijos' });
    await user.click(screen.getByRole('link', { name: 'Pereiti prie turinio' }));
    await waitFor(() => expect(window.location.hash).toBe('#main'));
    expect(window.location.pathname).toBe('/presentations');
    expect(within(main()).getByRole('heading', { level: 1, name: 'Prezentacijos' })).toBeInTheDocument();
    await titled(`Prezentacijos — ${SITE}`);
  });
});







// -----------------------------------------------------------
// As main.jsx mounts it
// -----------------------------------------------------------
//
// Production wraps the App in StrictMode (every effect runs,
// is cleaned up and runs again) with main.jsx's query policy
// of one retry; renderApp does neither. The shell must boot
// and navigate the same under it.
// -----------------------------------------------------------

describe('App under StrictMode, as main.jsx mounts it', () => {

  const renderStrictApp = (route) => {
    window.history.replaceState(null, '', route);
    const user = userEvent.setup();
    const view = render(
      <StrictMode>
        <QueryClientProvider client={makeQueryClient({ retry: 1 })}>
          <App />
        </QueryClientProvider>
      </StrictMode>
    );
    return { user, ...view };
  };


  it('boots: "/" lands on the default faucet, the tab titled', async () => {
    renderStrictApp('/');
    await landsOn('/faucet/evm/sepolia');
    expect(await within(main()).findByRole('heading', { level: 1, name: "Ethereum Sepolia faucet'as" })).toBeInTheDocument();
    await titled(`EVM čiaupas — ${SITE}`);
  });


  it('navigates: the family switch leads to another faucet, re-titled', async () => {
    const { user } = renderStrictApp('/faucet/evm/sepolia');
    await within(navbar()).findByRole('button', { name: 'Ethereum Sepolia' });
    await user.click(within(navbar()).getByRole('button', { name: 'UTXO' }));
    await landsOn('/faucet/utxo/btc4');
    expect(await within(main()).findByRole('heading', { level: 1, name: "Bitcoin Testnet4 faucet'as" })).toBeInTheDocument();
    await titled(`UTXO čiaupas — ${SITE}`);
  });


  it('asks the catalog once per mount cycle — StrictMode\'s second run shares the query', async () => {
    const seen = watchRequests();
    renderStrictApp('/presentations');
    await within(main()).findByRole('heading', { level: 1, name: 'Prezentacijos' });
    await waitFor(() => expect(within(navbar()).getByRole('button', { name: "Atidaryti faucet'ą" })).toBeEnabled());
    expect(seen.filter((request) => request === 'GET /api/faucet/catalog')).toHaveLength(1);
  });
});







// -----------------------------------------------------------
// "/" — the default faucet
// -----------------------------------------------------------

describe('App "/" — the default faucet', () => {

  it('sends "/" to the EVM faucet\'s backend default', async () => {
    renderApp({ route: '/' });
    await landsOn('/faucet/evm/sepolia');
    expect(await within(main()).findByRole('heading', { level: 1, name: "Ethereum Sepolia faucet'as" })).toBeInTheDocument();
  });


  it('lands on the student\'s last EVM pick', async () => {
    rememberPick('evm', 'hoodi');
    renderApp({ route: '/' });
    await landsOn('/faucet/evm/hoodi');
  });


  it('passes over a remembered pick the catalog no longer lists', async () => {
    rememberPick('evm', 'goerli');
    renderApp({ route: '/' });
    await landsOn('/faucet/evm/sepolia');
  });


  it('takes the first network by id when the backend default is gone too', async () => {
    given.json('get', '/api/faucet/catalog', catalogWith({
      evm: { default_network: 'goerli', networks: { ...f.evmNetworksMap, hoodi: { ...f.evmNetworksMap.hoodi, id: 0 } } },
    }));
    renderApp({ route: '/' });
    await landsOn('/faucet/evm/hoodi');
  });


  it('prefers EVM although UTXO comes first in the navbar — even with a UTXO pick remembered', async () => {
    rememberPick('utxo', 'knf');
    renderApp({ route: '/' });
    await landsOn('/faucet/evm/sepolia');
  });


  it.each([
    [['evm'], '/faucet/utxo/btc4'],
    [['evm', 'utxo'], '/faucet/erc20/LINK'],
    [['evm', 'utxo', 'erc20'], '/faucet/svm/solanaDevnet'],
    [['evm', 'utxo', 'erc20', 'svm'], '/faucet/move/suiTestnet'],
  ])('with %j disabled, goes on to the first live family in navbar order (%s)', async (disabled, target) => {
    given.json('get', '/api/faucet/catalog', catalogWithout(...disabled));
    renderApp({ route: '/' });
    await landsOn(target);
  });


  it('honours the last pick in the family it falls back to', async () => {
    given.json('get', '/api/faucet/catalog', catalogWithout('evm'));
    rememberPick('utxo', 'ltc4');
    renderApp({ route: '/' });
    await landsOn('/faucet/utxo/ltc4');
  });


  it('with no family configured, renders nothing — no redirect, no failure notice; the teaching pages stay reachable', async () => {
    given.json('get', '/api/faucet/catalog', catalogWithout('utxo', 'evm', 'erc20', 'svm', 'move'));
    renderApp({ route: '/' });
    // the answer has been taken in once the navbar remembered it
    await waitFor(() => expect(localStorage.getItem(CATALOG_CACHE_KEY)).not.toBeNull());
    await settle(100);
    expect(window.location.pathname).toBe('/');
    expect(main()).toBeEmptyDOMElement();
    expect(screen.queryByText(UNAVAILABLE)).toBeNull();
    expect(within(navbar()).getByRole('button', { name: "Atidaryti faucet'ą" })).toBeDisabled();
    expect(within(navbar()).getByRole('link', { name: 'Prezentacijos' })).toBeInTheDocument();
  });


  it('decides on data, never on a fetch in flight: "/" waits blank', async () => {
    given.hang('get', '/api/faucet/catalog');
    renderApp({ route: '/' });
    await settle(100);
    expect(window.location.pathname).toBe('/');
    expect(main()).toBeEmptyDOMElement();
    expect(document.title).toBe(SITE);
  });


  it('is a replace: Back from the faucet returns to where the student clicked the logo', async () => {
    const { user } = renderApp({ route: '/presentations' });
    await within(main()).findByRole('heading', { level: 1, name: 'Prezentacijos' });
    await user.click(within(navbar()).getByRole('link', { name: 'VU Kauno fakultetas' }));
    await landsOn('/faucet/evm/sepolia');

    await goBack();
    await landsOn('/presentations');
  });


  it('shares one catalog request between the navbar and the redirect', async () => {
    const seen = watchRequests();
    renderApp({ route: '/' });
    await landsOn('/faucet/evm/sepolia');
    await within(main()).findByRole('heading', { level: 1, name: "Ethereum Sepolia faucet'as" });
    expect(seen.filter((request) => request === 'GET /api/faucet/catalog')).toHaveLength(1);
  });


  it('decides from the remembered catalog while the fetch is out', async () => {
    rememberCatalog(catalogWithout('evm'));
    given.hang('get', '/api/faucet/catalog');
    renderApp({ route: '/' });
    await landsOn('/faucet/utxo/btc4');
  });


  it('lets the remembered catalog stand in for a failed fetch — no failure notice', async () => {
    rememberCatalog(f.catalog);
    given.error('get', '/api/faucet/catalog', 'Vidinė serverio klaida', 500);
    renderApp({ route: '/' });
    await landsOn('/faucet/evm/sepolia');
    expect(screen.queryByText(UNAVAILABLE)).toBeNull();
  });
});







// -----------------------------------------------------------
// "/" — the catalog unavailable
// -----------------------------------------------------------

describe('App "/" — the catalog unavailable', () => {

  it('says the faucet list is unreachable and offers the pages that need no backend', async () => {
    given.error('get', '/api/faucet/catalog', 'Vidinė serverio klaida', 500);
    renderApp({ route: '/' });
    expect(await within(main()).findByText(UNAVAILABLE)).toBeInTheDocument();
    expect(within(main()).getByRole('button', { name: 'Bandyti dar kartą' })).toBeInTheDocument();
    expect(within(main()).getAllByRole('link').map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      ['Blokų grandinės simuliatorius', '/sha256'],
      ['Prezentacijos', '/presentations'],
    ]);
    expect(window.location.pathname).toBe('/');
    expect(document.title).toBe(SITE);
  });


  it('a dropped connection is the same outage', async () => {
    given.networkError('get', '/api/faucet/catalog');
    renderApp({ route: '/' });
    expect(await within(main()).findByText(UNAVAILABLE)).toBeInTheDocument();
  });


  it('"Bandyti dar kartą" asks again and, once the catalog answers, goes on to the default faucet', async () => {
    given.sequence('get', '/api/faucet/catalog', [{ status: 500, body: { error: 'Vidinė serverio klaida' } }, { body: f.catalog }]);
    const { user } = renderApp({ route: '/' });
    await user.click(await within(main()).findByRole('button', { name: 'Bandyti dar kartą' }));
    await landsOn('/faucet/evm/sepolia');
  });


  it('a retry that fails again keeps the notice', async () => {
    const seen = given.capture('get', '/api/faucet/catalog', { error: 'Vidinė serverio klaida' }, { status: 500 });
    const { user } = renderApp({ route: '/' });
    await user.click(await within(main()).findByRole('button', { name: 'Bandyti dar kartą' }));
    await waitFor(() => expect(seen).toHaveLength(2));
    await settle(50);
    expect(within(main()).getByText(UNAVAILABLE)).toBeInTheDocument();
    expect(window.location.pathname).toBe('/');
  });


  it('the navbar\'s retry recovers "/" too — they share the one query', async () => {
    given.sequence('get', '/api/faucet/catalog', [{ status: 500, body: { error: 'Vidinė serverio klaida' } }, { body: f.catalog }]);
    const { user } = renderApp({ route: '/' });
    await within(main()).findByText(UNAVAILABLE);
    await user.click(within(navbar()).getByRole('button', { name: 'Bandyti dar kartą' }));
    await landsOn('/faucet/evm/sepolia');
  });


  it.each([
    ['Blokų grandinės simuliatorius', '/sha256', 'Blokų grandinės simuliatorius'],
    ['Prezentacijos', '/presentations', 'Prezentacijos'],
  ])('"%s" opens %s, which works without the backend', async (name, path, heading) => {
    given.error('get', '/api/faucet/catalog', 'Vidinė serverio klaida', 500);
    const { user } = renderApp({ route: '/' });
    await within(main()).findByText(UNAVAILABLE);
    await user.click(within(main()).getByRole('link', { name }));
    await landsOn(path);
    expect(await within(main()).findByRole('heading', { level: 1, name: heading })).toBeInTheDocument();
  });
});







// -----------------------------------------------------------
// Family index redirects and unknown families
// -----------------------------------------------------------
//
// A truncated family path (no network / token) goes through
// "/" to the default faucet instead of an empty outlet.
// -----------------------------------------------------------

describe('App — family index redirects', () => {

  it.each([
    ['/faucet'],
    ['/faucet/evm'],
    ['/faucet/evm/'],
    ['/faucet/erc20'],
    ['/faucet/utxo'],
    ['/faucet/svm'],
    ['/faucet/move'],
    ['/graph'],
  ])('%s lands on the default faucet', async (route) => {
    renderApp({ route });
    await landsOn('/faucet/evm/sepolia');
  });


  it('replaces the truncated path too — Back skips it', async () => {
    renderApp({ route: '/presentations' });
    await within(main()).findByRole('heading', { level: 1, name: 'Prezentacijos' });
    await navigateTo('/faucet/utxo');
    await landsOn('/faucet/evm/sepolia');

    await goBack();
    await landsOn('/presentations');
  });


  it.fails('/graph/utxo — the UTXO graph without a network — redirects like the others (or is not found) — PINNED KNOWN BUG: it matches /graph/:network and renders the EVM graph for a network named "utxo"', async () => {
    renderApp({ route: '/graph/utxo' });
    await waitFor(() => {
      const redirected = window.location.pathname === '/faucet/evm/sepolia';
      const notFound = within(main()).queryByText('Tokio puslapio nėra.') !== null;
      expect(redirected || notFound).toBe(true);
    }, { timeout: 1500 });
  });


  it('shows what /graph/utxo does today: the EVM graph asking for a faucet named "utxo", under the UTXO graph\'s title', async () => {
    renderApp({ route: '/graph/utxo' });
    expect(await within(main()).findByText('Nepavyko gauti čiaupo adreso')).toBeInTheDocument();
    expect(document.title).toBe(`UTXO transakcijos — ${SITE}`);
  });


  it('an unknown family under /faucet is not found, under the bare site name', async () => {
    renderApp({ route: '/faucet/cosmos/hub' });
    expect(await within(main()).findByText('Tokio puslapio nėra.')).toBeInTheDocument();
    await titled(SITE);
  });
});







// -----------------------------------------------------------
// The tab title
// -----------------------------------------------------------

describe('App — the tab title', () => {

  it('names the route family before the site name', async () => {
    renderApp({ route: '/faucet/utxo/btc4' });
    await titled(`UTXO čiaupas — ${SITE}`);
  });


  it('re-titles on client-side navigation, and on Back', async () => {
    const { user } = renderApp({ route: '/presentations' });
    await titled(`Prezentacijos — ${SITE}`);

    await user.click(within(navbar()).getByRole('button', { name: 'Kiti įrankiai' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Blokų grandinės simuliatorius' }));
    await titled(`Blokų grandinės simuliatorius — ${SITE}`);

    await goBack();
    await titled(`Prezentacijos — ${SITE}`);
  });


  it('lets the longer prefix win: the UTXO graph is not titled as the EVM graph', async () => {
    const first = renderApp({ route: '/graph/utxo/btc4' });
    await titled(`UTXO transakcijos — ${SITE}`);
    first.unmount();

    renderApp({ route: '/graph/sepolia' });
    await titled(`Transakcijų srautas — ${SITE}`);
  });


  it('keeps the bare site name on a path no route family claims', async () => {
    renderApp({ route: '/nieko' });
    await within(main()).findByText('Tokio puslapio nėra.');
    await titled(SITE);
  });


  it.fails('keeps the bare site name on a path that merely begins with a route\'s letters (/graphs) — PINNED KNOWN BUG: ROUTE_TITLES matches by startsWith, with no segment boundary', async () => {
    renderApp({ route: '/graphs' });
    await within(main()).findByText('Tokio puslapio nėra.');
    await settle(50);
    expect(document.title).toBe(SITE);
  });
});







// -----------------------------------------------------------
// The error boundaries
// -----------------------------------------------------------
//
// Two boundaries: one around the navbar (no key — it stays
// until a reload), one around the page area (keyed by the
// route). Each crash here is on purpose, declared with
// allowConsoleErrors.
// -----------------------------------------------------------

describe('App — the error boundaries', () => {

  it('a navbar that throws costs only the navbar: the page, the footer and the skip link stay', async () => {
    allowConsoleErrors(/Render failed:/);
    rememberCatalog(UNREADABLE_CATALOG);
    renderApp({ route: '/presentations' });

    expect(screen.getAllByText(CRASH_CARD_TEXT)).toHaveLength(1);
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(within(main()).getByRole('heading', { level: 1, name: 'Prezentacijos' })).toBeInTheDocument();
    expect(within(main()).queryByText(CRASH_CARD_TEXT)).toBeNull();
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Pereiti prie turinio' })).toBeInTheDocument();
  });


  it('the navbar\'s card stays when the page changes — its boundary has no reset key, only a reload brings the bar back', async () => {
    allowConsoleErrors(/Render failed:/);
    rememberCatalog(UNREADABLE_CATALOG);
    const { user } = renderApp({ route: '/nieko' });
    await user.click(within(main()).getByRole('link', { name: 'Prezentacijos' }));

    expect(await within(main()).findByRole('heading', { level: 1, name: 'Prezentacijos' })).toBeInTheDocument();
    expect(screen.getAllByText(CRASH_CARD_TEXT)).toHaveLength(1);
    expect(screen.queryByRole('navigation')).toBeNull();
  });


  it('at "/" the redirect reads the same catalog — each boundary holds its own crash, the footer stands', async () => {
    allowConsoleErrors(/Render failed:/);
    rememberCatalog(UNREADABLE_CATALOG);
    renderApp({ route: '/' });

    expect(screen.getAllByText(CRASH_CARD_TEXT)).toHaveLength(2);
    expect(within(main()).getByText(CRASH_CARD_TEXT)).toBeInTheDocument();
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
  });


  it('a page that throws is replaced by the card inside the page area; the navbar, the footer and the title stay', async () => {
    allowConsoleErrors(/Render failed:/);
    crash.page = true;
    renderApp({ route: '/dapps-server' });

    expect(await within(main()).findByText(CRASH_CARD_TEXT)).toBeInTheDocument();
    expect(within(main()).getByRole('button', { name: 'Perkrauti' })).toBeInTheDocument();
    expect(navbar()).toBeInTheDocument();
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
    await titled(`DAPPS serveris — ${SITE}`);
  });


  it('leaving the crashed page recovers: the next page renders', async () => {
    allowConsoleErrors(/Render failed:/);
    crash.page = true;
    const { user } = renderApp({ route: '/dapps-server' });
    await within(main()).findByText(CRASH_CARD_TEXT);

    await user.click(within(navbar()).getByRole('link', { name: 'Prezentacijos' }));
    expect(await within(main()).findByRole('heading', { level: 1, name: 'Prezentacijos' })).toBeInTheDocument();
    expect(screen.queryByText(CRASH_CARD_TEXT)).toBeNull();
  });


  it('coming back renders the page afresh once it no longer throws', async () => {
    allowConsoleErrors(/Render failed:/);
    crash.page = true;
    const { user } = renderApp({ route: '/dapps-server' });
    await within(main()).findByText(CRASH_CARD_TEXT);
    await user.click(within(navbar()).getByRole('link', { name: 'Prezentacijos' }));
    await within(main()).findByRole('heading', { level: 1, name: 'Prezentacijos' });

    crash.page = false;
    await user.click(within(navbar()).getByRole('button', { name: 'Kiti įrankiai' }));
    await user.click(await screen.findByRole('menuitem', { name: 'DAPPS serveris' }));
    expect(await within(main()).findByRole('heading', { level: 1, name: 'DAPPS serveris' })).toBeInTheDocument();
  });


  it('the navbar keeps working beside the card: its jump leads to a working faucet', async () => {
    allowConsoleErrors(/Render failed:/);
    crash.page = true;
    const { user } = renderApp({ route: '/dapps-server' });
    await within(main()).findByText(CRASH_CARD_TEXT);

    const quickOpen = within(navbar()).getByRole('button', { name: "Atidaryti faucet'ą" });
    await waitFor(() => expect(quickOpen).toBeEnabled());
    await user.click(quickOpen);
    await landsOn('/faucet/evm/sepolia');
    expect(await within(main()).findByRole('heading', { level: 1, name: "Ethereum Sepolia faucet'as" })).toBeInTheDocument();
  });
});







// -----------------------------------------------------------
// Backend contract — GET /api/faucet/catalog at "/"
// -----------------------------------------------------------
//
// Loaded: "/" goes on to the default faucet. A failure: the
// CatalogUnavailable notice. In flight: "/" waits, blank.
// Whatever the body: no crash, the footer and the skip link
// stand (the navbar's own view of this endpoint is in
// components/navbar.test.jsx).
// -----------------------------------------------------------

describeEndpointContract({
  path: '/api/faucet/catalog',
  fixture: f.catalog,
  render: () => renderApp({ route: '/' }),
  chrome: () => screen.getByRole('contentinfo') && screen.getByRole('link', { name: 'Pereiti prie turinio' }),
  loaded: async () => {
    await landsOn('/faucet/evm/sepolia');
  },
  failed: async () => {
    expect(await within(main()).findByText(UNAVAILABLE)).toBeInTheDocument();
  },
  loading: () => window.location.pathname === '/' && main().childElementCount === 0,
});
