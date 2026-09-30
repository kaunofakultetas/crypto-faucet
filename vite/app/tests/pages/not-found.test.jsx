// -----------------------------------------------------------
//  [*] Tests — NotFound page (every unmatched route)
//
//  The catch-all's card on its own — "404", "Tokio puslapio
//  nėra." and the three ways back, each a link the router
//  follows without a reload — and the page in the App: what
//  lands on it (a typo, the retired /videos bookmark, extra
//  segments under a faucet or graph route), inside the full
//  chrome, the tab keeping the bare site name, no request of
//  its own, and "Į faucet'ą" leading through "/" to the
//  default faucet.
// -----------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { renderPage, renderApp } from '../support/render';
import { settle } from '../support/backend/contract';
import { LocationProbe, currentPath } from '../support/shell/router';
import { watchRequests } from '../support/shell/requests';
import NotFoundPage from '@/pages/NotFound/Page';


const SITE_TITLE = "VU KNF Faucet'as";

const renderNotFound = () => renderPage(<><NotFoundPage /><LocationProbe /></>, { route: '/nieko' });







// -----------------------------------------------------------
// The card
// -----------------------------------------------------------

describe('NotFound page', () => {

  it('says what happened: 404, there is no such page', () => {
    renderNotFound();
    expect(screen.getByText('404')).toBeInTheDocument();
    expect(screen.getByText('Tokio puslapio nėra.')).toBeInTheDocument();
  });


  it('offers three ways back: the faucet, the simulator and the presentations', () => {
    renderNotFound();
    expect(screen.getAllByRole('link').map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      ["Į faucet'ą", '/'],
      ['Blokų grandinės simuliatorius', '/sha256'],
      ['Prezentacijos', '/presentations'],
    ]);
  });


  it.each([
    ["Į faucet'ą", '/'],
    ['Blokų grandinės simuliatorius', '/sha256'],
    ['Prezentacijos', '/presentations'],
  ])('"%s" is followed by the router, to %s', async (name, path) => {
    const { user } = renderNotFound();
    await user.click(screen.getByRole('link', { name }));
    expect(currentPath()).toBe(path);
  });
});







// -----------------------------------------------------------
// In the App
// -----------------------------------------------------------

describe('NotFound page in the App', () => {

  it.each([
    ['a typo', '/faucte/evm/sepolia'],
    ['the retired /videos bookmark', '/videos'],
    ['a path nobody routes', '/nieko/nera'],
  ])('%s (%s) lands on the card, inside the chrome, under the bare site title', async (_, route) => {
    renderApp({ route });
    const main = screen.getByRole('main');
    expect(await within(main).findByText('Tokio puslapio nėra.')).toBeInTheDocument();
    expect(screen.getByRole('navigation')).toBeInTheDocument();
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe(SITE_TITLE));
    expect(window.location.pathname).toBe(route);
  });


  it.each([
    ['/faucet/evm/sepolia/extra'],
    ['/faucet/erc20/LINK/extra'],
    ['/graph/sepolia/extra'],
    ['/graph/utxo/btc4/extra'],
    ['/sha256/extra'],
  ])('extra segments under a routed page (%s) are not found either', async (route) => {
    renderApp({ route });
    expect(await within(screen.getByRole('main')).findByText('Tokio puslapio nėra.')).toBeInTheDocument();
  });


  it('makes no request of its own — only the navbar reads its catalog', async () => {
    const seen = watchRequests();
    renderApp({ route: '/nieko' });
    await screen.findByText('Tokio puslapio nėra.');
    await waitFor(() => expect(seen).toContain('GET /api/faucet/catalog'));
    await settle(100);
    expect(seen).toEqual(['GET /api/faucet/catalog']);
  });


  it('"Į faucet\'ą" leads through "/" to the default faucet', async () => {
    const { user } = renderApp({ route: '/nieko' });
    await user.click(await screen.findByRole('link', { name: "Į faucet'ą" }));
    await waitFor(() => expect(window.location.pathname).toBe('/faucet/evm/sepolia'));
    expect(await screen.findByRole('heading', { level: 1, name: "Ethereum Sepolia faucet'as" })).toBeInTheDocument();
  });
});
