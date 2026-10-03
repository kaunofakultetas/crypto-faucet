// -----------------------------------------------------------
//  [*] Tests — the test harness itself (smoke)
//
//  Proves the foundation before anything is built on it: a
//  page's relative axios requests reach the msw double and its
//  answers reach the screen, a backend refusal becomes the
//  page's own error presentation, the real App boots at a
//  route through its own BrowserRouter, and the guards work —
//  a request the double does not know fails the test, and so
//  does a React bug report on the console.
// -----------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import axios from 'axios';
import { renderPage, renderApp } from '../support/render';
import { given } from '../support/backend/server';
import { allowUnhandledRequests, allowConsoleErrors } from '../support/setup';
import { expectNoCrash } from '../support/backend/contract';
import * as f from '../support/backend/fixtures';
import FaucetUTXO from '@/pages/Faucet_UTXO/Page';


const renderUtxoFaucet = () => renderPage(<FaucetUTXO />, { route: '/faucet/utxo/btc4', path: '/faucet/utxo/:network' });







// -----------------------------------------------------------
// harness smoke
// -----------------------------------------------------------
//
// Uses the UTXO faucet page — two queries (the network list and
// the faucet's balance) and a plain form.
// -----------------------------------------------------------

describe('harness smoke', () => {

  it('renders a page whose queries reach the backend double', async () => {
    renderUtxoFaucet();

    expect(await screen.findByText(f.FAUCET_UTXO)).toBeInTheDocument();
    expect(screen.getByLabelText('Jūsų tBTC4 adresas')).toBeInTheDocument();
    expectNoCrash();
  });


  it('shows the page\'s own error card when the network list fails', async () => {
    given.error('get', '/api/utxo/networks', 'Vidinė serverio klaida', 500);
    renderUtxoFaucet();

    expect(await screen.findByText('Vidinė serverio klaida. Perkraukite puslapį.')).toBeInTheDocument();
  });


  it('boots the real App at a route and titles the tab', async () => {
    renderApp({ route: '/faucet/utxo/btc4' });

    expect(await screen.findByText(f.FAUCET_UTXO)).toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe("UTXO čiaupas — VU KNF Faucet'as"));
  });


  it('sends "/" to the default EVM faucet', async () => {
    renderApp({ route: '/' });

    await waitFor(() => expect(window.location.pathname).toBe('/faucet/evm/sepolia'));
  });


  it('records a request no handler answers (the test declares it expects one)', async () => {
    allowUnhandledRequests();
    await expect(axios.get('/api/no-such-endpoint')).rejects.toThrow();
  });


  it('lets a test declare a console error it provokes on purpose', () => {
    allowConsoleErrors(/Render failed:/);
    console.error('Render failed:', new Error('on purpose'));
  });
});
