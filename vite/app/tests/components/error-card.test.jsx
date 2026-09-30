// -----------------------------------------------------------
//  [*] Tests — ErrorCard (the red card a page falls back to)
//
//  The card on its own — the message it is handed, as one
//  paragraph, text and values composed the way the pages
//  compose them, markup in a message shown as text — and the
//  card in use: the faucet pages put it up INSTEAD of the page
//  for a :network the catalog does not know, and the ERC-20
//  page for a token the backend refuses (the backend's own
//  sentence), the App's chrome standing around it.
// -----------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderPage, renderApp } from '../support/render';
import ErrorCard from '@/components/ErrorCard';







// -----------------------------------------------------------
// On its own
// -----------------------------------------------------------

describe('ErrorCard', () => {

  it('shows the message it is handed as one paragraph', () => {
    renderPage(<ErrorCard>Nepavyko gauti tinklų sąrašo. Perkraukite puslapį.</ErrorCard>);
    const message = screen.getByText('Nepavyko gauti tinklų sąrašo. Perkraukite puslapį.');
    expect(message.tagName).toBe('P');
  });


  it('composes text and a value into one sentence, the way the pages do', () => {
    const network = 'sepolia2';
    renderPage(<ErrorCard>Nežinomas tinklas: {network}</ErrorCard>);
    expect(screen.getByText('Nežinomas tinklas: sepolia2')).toBeInTheDocument();
  });


  it('shows markup in a message as text, never as elements', () => {
    const { container } = renderPage(<ErrorCard>{'<img src=x onerror=alert(1)> <b>Klaida</b>'}</ErrorCard>);
    expect(screen.getByText('<img src=x onerror=alert(1)> <b>Klaida</b>')).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
  });


  it('offers nothing to click — the navbar is the way on', () => {
    renderPage(<ErrorCard>Nežinomas tinklas: x</ErrorCard>);
    expect(screen.queryAllByRole('button')).toEqual([]);
    expect(screen.queryAllByRole('link')).toEqual([]);
  });
});







// -----------------------------------------------------------
// In use
// -----------------------------------------------------------
//
// Through the real App: the default backend answers an
// unknown network key with its 400, the catalog-driven pages
// decide from /api/<family>/networks alone.
// -----------------------------------------------------------

describe('ErrorCard in use', () => {

  it.each([
    ['/faucet/evm/nera'],
    ['/faucet/utxo/nera'],
    ['/faucet/svm/nera'],
    ['/faucet/move/nera'],
  ])('replaces the faucet page at %s with "Nežinomas tinklas", the chrome standing', async (route) => {
    renderApp({ route });
    const main = screen.getByRole('main');
    expect(await within(main).findByText('Nežinomas tinklas: nera')).toBeInTheDocument();
    expect(within(main).queryByRole('heading', { level: 1 })).toBeNull();
    expect(screen.getByRole('navigation')).toBeInTheDocument();
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
  });


  it('carries the backend\'s own sentence for a token it refuses', async () => {
    renderApp({ route: '/faucet/erc20/NERA' });
    const main = screen.getByRole('main');
    expect(await within(main).findByText('Nepalaikomas žetonas: NERA')).toBeInTheDocument();
    expect(within(main).queryByRole('heading', { level: 1 })).toBeNull();
  });
});
