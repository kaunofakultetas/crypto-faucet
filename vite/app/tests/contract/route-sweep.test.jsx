// -----------------------------------------------------------
//  [*] Tests — the route sweep (every route × every backend state)
//
//  Every route of App.jsx, with real keys from the fixtures,
//  rendered through the real App (renderApp) under the
//  conditions every page must tolerate whatever it does
//  inside:
//
//    - the default backend — the route lands where it should
//      (a family index through "/" on the default faucet),
//      renders its page, titles the tab, and makes only
//      requests the double knows (setup.js fails the test on
//      any other); its new-tab links carry rel=noopener, its
//      images an alt
//    - every /api GET answering 500 { error } — the navbar
//      says its list is unreachable, the page shows ITS
//      failure (the backend's own sentence where the page
//      passes it on), nothing crashes
//    - every /api GET answering a JSON string — an answer of
//      the wrong shape: nothing crashes
//    - every /api GET dropping the connection — like the 500,
//      with the pages' own words for a failure that carries
//      no message
//
//  In every state the navbar (or, on a catalog outage, its
//  notice) and the footer stand. The per-page tests cover
//  behaviour; this file is the safety net no route can be
//  forgotten by — its first test checks it covers every
//  route App.jsx declares.
//
//  The EVM graph draws with vis-network on a canvas jsdom
//  lacks; a Network that draws nothing stands in for it here
//  (the graph's own tests live with the Graph page).
//
//  Pinned: the ERC-20 page crashes on a JSON-string answer.
// -----------------------------------------------------------

import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { HttpResponse } from 'msw';
import { renderApp } from '../support/render';
import { apiError } from '../support/backend/server';
import { allowConsoleErrors } from '../support/setup';
import { expectNoCrash, settle } from '../support/backend/contract';
import { backendIdle, everyGet } from '../support/shell/requests';
import { appRoutes } from '../support/shell/source';


// A vis Network that draws nothing but answers every call
// the EVM graph makes of it
vi.mock('vis-network', () => ({
  Network: class Network {
    on() {}
    getScale() { return 1; }
    getViewPosition() { return { x: 0, y: 0 }; }
    moveTo() {}
    getNodeAt() { return undefined; }
    getPositions() { return {}; }
    destroy() {}
  },
}));


const SITE = "VU KNF Faucet'as";
const UNAVAILABLE = "Faucet'ų sąrašas nepasiekiamas. Serveris gali būti perkraunamas.";
const NETWORKS_FAILED = 'Nepavyko gauti tinklų sąrašo. Perkraukite puslapį.';

// The sentence every failing GET carries in the 500 mode
const MESSAGE = 'Vidinė serverio klaida';

const titleOf = (name) => (name ? `${name} — ${SITE}` : SITE);

const main = () => screen.getByRole('main');

// What shows a route rendered, and how it shows a failure —
// status: the words inside a live status region (the UTXO
// graph's canvas notice)
const heading = (name) => () => within(main()).findByRole('heading', { level: 1, name });
const text = (words) => () => within(main()).findByText(words);
const status = (words) => async () => {
  const shown = await within(main()).findByText(words);
  expect(shown.closest('[role="status"]')).not.toBeNull();
  return shown;
};







// -----------------------------------------------------------
// ROUTES
// -----------------------------------------------------------
//
// Every route to sweep:
//
//   path     — where the student starts
//   lands    — where the default backend takes them (a family
//              index goes through "/" to the default faucet)
//   title    — the tab's route name there (null: the bare
//              site name)
//   shows    — finds what proves the page rendered
//   failed   — (message) → finds how the page presents a
//              failed read; message is the backend's sentence
//              (500 mode) or null (connection dropped). None:
//              the page reads nothing — it simply still shows
//   index    — a family index: on a failed catalog it rests
//              on "/" with the CatalogUnavailable notice, on a
//              wrong-shaped one on a blank "/"
// -----------------------------------------------------------

const FAUCET = { lands: '/faucet/evm/sepolia', title: 'EVM čiaupas', shows: heading("Ethereum Sepolia faucet'as") };

const ROUTES = [
  { path: '/faucet/evm/sepolia', title: 'EVM čiaupas', shows: heading("Ethereum Sepolia faucet'as"), failed: () => text(NETWORKS_FAILED)() },
  { path: '/faucet/erc20/LINK', title: 'ERC-20 čiaupas', shows: heading("Chainlink faucet'as"), failed: (message) => text(message ?? 'Nepavyko gauti žetono informacijos')() },
  { path: '/faucet/utxo/btc4', title: 'UTXO čiaupas', shows: heading("Bitcoin Testnet4 faucet'as"), failed: () => text(NETWORKS_FAILED)() },
  { path: '/faucet/svm/solanaDevnet', title: 'SVM čiaupas', shows: heading("Solana Devnet faucet'as"), failed: () => text(NETWORKS_FAILED)() },
  { path: '/faucet/move/suiTestnet', title: 'Move čiaupas', shows: heading("Sui Testnet faucet'as"), failed: () => text(NETWORKS_FAILED)() },
  { path: '/graph/sepolia', title: 'Transakcijų srautas', shows: heading('Transakcijų srautas — Ethereum Sepolia'), failed: () => text('Nepavyko gauti čiaupo adreso')() },
  { path: '/graph/utxo/btc4', title: 'UTXO transakcijos', shows: heading('Transakcijų Srautas - Bitcoin Testnet4'), failed: (message) => status(message ?? 'Nepavyko gauti transakcijų')() },
  { path: '/sha256', title: 'Blokų grandinės simuliatorius', shows: heading('Blokų grandinės simuliatorius') },
  { path: '/presentations', title: 'Prezentacijos', shows: heading('Prezentacijos') },
  { path: '/dapps-server', title: 'DAPPS serveris', shows: heading('DAPPS serveris') },
  { path: '/nieko/nera', title: null, shows: text('Tokio puslapio nėra.') },
  { path: '/', index: true, ...FAUCET },
  { path: '/faucet', index: true, ...FAUCET },
  { path: '/faucet/evm', index: true, ...FAUCET },
  { path: '/faucet/erc20', index: true, ...FAUCET },
  { path: '/faucet/utxo', index: true, ...FAUCET },
  { path: '/faucet/svm', index: true, ...FAUCET },
  { path: '/faucet/move', index: true, ...FAUCET },
  { path: '/graph', index: true, ...FAUCET },
];

// The route × state combinations that fail today, each with
// what breaks — run as it.fails so the suite stays green
// while the defect is on record
const PINS = {
  '/faucet/erc20/LINK × JSON string': 'the page destructures { token, deployments } from any truthy body and deriveFlow calls deployments.find — a string body crashes it',
};







// -----------------------------------------------------------
// Assertions shared by the states
// -----------------------------------------------------------

// The chrome around every page: the navbar's landmark (or its
// crash card — never expected here) and the footer
const expectChrome = () => {
  expect(screen.getByRole('navigation')).toBeInTheDocument();
  expect(screen.getByRole('contentinfo')).toBeInTheDocument();
};

// New-tab links cannot reach back into the faucet, images
// say what they are (or that they are decoration)
const expectSafeMarkup = () => {
  for (const link of document.querySelectorAll('a[target="_blank"]')) {
    expect(link.getAttribute('rel') ?? '', link.getAttribute('href')).toMatch(/\bnoopener\b/);
  }
  for (const image of document.querySelectorAll('img')) {
    expect(image.hasAttribute('alt'), image.getAttribute('src')).toBe(true);
  }
};

const landsOn = async (path) => {
  await waitFor(() => expect(window.location.pathname).toBe(path));
};

const titled = async (name) => {
  await waitFor(() => expect(document.title).toBe(titleOf(name)));
};

// The catalog failed: the navbar says so
const navbarSaysUnreachable = async () => {
  expect(await within(screen.getByRole('navigation')).findByText("Faucet'ų sąrašas nepasiekiamas")).toBeInTheDocument();
};

// A failure mode: every GET answers `respond`; the route is
// rendered and the backend let go idle
const renderFailing = async (path, respond) => {
  const gets = everyGet(respond);
  renderApp({ route: path });
  await backendIdle(gets);
  return gets;
};

// What a failed read looks like on this route: its own
// presentation, or the page simply still there; a family
// index rests on "/" with the CatalogUnavailable notice
const expectFailureShown = async (route, message) => {
  if (route.index) {
    await landsOn('/');
    expect(await within(main()).findByText(UNAVAILABLE)).toBeInTheDocument();
    return;
  }
  expect(await (route.failed ? route.failed(message) : route.shows())).toBeInTheDocument();
};







// -----------------------------------------------------------
// The sweep
// -----------------------------------------------------------

describe('route sweep', () => {

  it('covers every route App.jsx declares', () => {
    const swept = ROUTES.map((route) => route.path);
    const uncovered = appRoutes()
      .filter((route) => route.element)
      .filter((route) => {
        if (route.path === '*') return !ROUTES.some((candidate) => candidate.title === null && candidate.shows);
        const pattern = new RegExp(`^${route.path.replace(/:\w+/g, '[^/]+')}$`);
        return !swept.some((path) => pattern.test(path));
      })
      .map((route) => route.path);
    expect(uncovered).toEqual([]);
  });


  describe.each(ROUTES)('$path', (route) => {

    const runner = (state) => (PINS[`${route.path} × ${state}`] ? it.fails : it);
    const named = (state, name) => (PINS[`${route.path} × ${state}`] ? `${name} — PINNED KNOWN BUG: ${PINS[`${route.path} × ${state}`]}` : name);


    runner('default')(named('default', 'renders under the default backend, titles the tab and asks only what the double knows'), async () => {
      renderApp({ route: route.path });
      await landsOn(route.lands ?? route.path);
      expect(await route.shows()).toBeInTheDocument();
      await titled(route.title);
      await settle(100);
      expectNoCrash();
      expectChrome();
      expectSafeMarkup();
    });


    runner('500')(named('500', 'shows the failure, not a crash, when every GET answers 500 { error }'), async () => {
      await renderFailing(route.path, () => HttpResponse.json(apiError(MESSAGE), { status: 500 }));
      await navbarSaysUnreachable();
      await expectFailureShown(route, MESSAGE);
      await titled(route.index ? null : route.title);
      expectNoCrash();
      expectChrome();
    });


    runner('JSON string')(named('JSON string', 'survives every GET answering a JSON string'), async () => {
      if (PINS[`${route.path} × JSON string`]) allowConsoleErrors(/Render failed:/);
      await renderFailing(route.path, () => HttpResponse.json('netikėtas atsakymas'));
      await settle(100);
      if (route.index) await landsOn('/');
      else expect(window.location.pathname).toBe(route.path);
      await titled(route.index ? null : route.title);
      expectNoCrash();
      expectChrome();
    });


    runner('dropped')(named('dropped', 'shows the failure, not a crash, when every GET drops the connection'), async () => {
      await renderFailing(route.path, () => HttpResponse.error());
      await navbarSaysUnreachable();
      await expectFailureShown(route, null);
      await titled(route.index ? null : route.title);
      expectNoCrash();
      expectChrome();
    });
  });
});
