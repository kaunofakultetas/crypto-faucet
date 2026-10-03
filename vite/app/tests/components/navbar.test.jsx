// -----------------------------------------------------------
//  [*] Tests — Navbar (the burgundy top bar) and its catalog
//
//  The bar on its own, rendered at a route with the location
//  probe beside it:
//    - the fixed parts: the logo home, "Prezentacijos", the
//      "Kiti įrankiai" menu of teaching tools
//    - on a faucet page: the segmented family switch (the
//      live families in navbar order, the URL's pressed; a
//      click jumps to that family's pick — last used, backend
//      default, first entry — the pressed segment inert) and
//      the picker, labelled by what the family is keyed by
//    - elsewhere: "Atidaryti faucet'ą", disabled until the
//      catalog knows a target, leading back to the family the
//      student was on last
//    - the catalog's lifecycle: every family shown while it
//      loads, a disabled (empty) family hidden, a URL into one
//      saying so, a failed fetch with nothing remembered
//      saying so with a retry, the remembered copy
//      (catalog:v2) drawn at once and kept through a failed
//      refresh, an old-version, corrupt or blocked copy
//      ignored
//  Then the exports on their own — FAUCET_TYPES' itemsOf /
//  defaultOf, faucetTargetFor's pick order, useFaucetCatalogs'
//  flags — and the backend contract of GET /api/faucet/catalog
//  as the navbar consumes it.
// -----------------------------------------------------------

import { describe, it, expect, vi } from 'vitest';
import { renderHook, screen, waitFor, within } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { renderPage, makeQueryClient } from '../support/render';
import { given } from '../support/backend/server';
import { describeEndpointContract, settle } from '../support/backend/contract';
import { LocationProbe, currentPath } from '../support/shell/router';
import { CATALOG_CACHE_KEY, catalogWith, catalogWithout, rememberCatalog, rememberPick } from '../support/shell/catalog';
import * as f from '../support/backend/fixtures';
import Navbar, { FAUCET_TYPES, faucetTargetFor, useFaucetCatalogs } from '@/components/Navbar';


const renderNavbar = (route = '/presentations') => renderPage(<><Navbar /><LocationProbe /></>, { route });

const navbar = () => screen.getByRole('navigation');

// The switch's segments, each as its caption and its
// aria-pressed state
const segments = () => within(within(navbar()).getByRole('group')).getAllByRole('button')
  .map((button) => [button.textContent, button.getAttribute('aria-pressed')]);

const captions = () => segments().map(([caption]) => caption);

const segment = (caption) => within(within(navbar()).getByRole('group')).getByRole('button', { name: caption });

const quickOpen = () => within(navbar()).getByRole('button', { name: "Atidaryti faucet'ą" });

// The picker's trigger names the pick once the catalog is in
const pickerShows = (name) => within(navbar()).findByRole('button', { name });

const ALL_CAPTIONS = ['UTXO', 'EVM', 'ERC-20', 'SVM', 'MoveVM'];

const EVERY_FAMILY = FAUCET_TYPES.map((type) => type.key);

const typeOf = (key) => FAUCET_TYPES.find((type) => type.key === key);

// One faucet URL per family, in navbar order: the family, its
// route, the switch's caption and the pick the picker names
const FAMILY_URLS = [
  ['utxo', '/faucet/utxo/btc4', 'UTXO', 'Bitcoin Testnet4'],
  ['evm', '/faucet/evm/sepolia', 'EVM', 'Ethereum Sepolia'],
  ['erc20', '/faucet/erc20/LINK', 'ERC-20', 'Chainlink (LINK)'],
  ['svm', '/faucet/svm/solanaDevnet', 'SVM', 'Solana Devnet'],
  ['move', '/faucet/move/suiTestnet', 'MoveVM', 'Sui Testnet'],
];







// -----------------------------------------------------------
// The fixed parts
// -----------------------------------------------------------

describe('Navbar — the fixed parts', () => {

  it('is the navigation landmark, its logo leading home', () => {
    renderNavbar();
    const logo = within(navbar()).getByRole('link', { name: 'VU Kauno fakultetas' });
    expect(logo).toHaveAttribute('href', '/');
    expect(within(logo).getByRole('img')).toHaveAttribute('src', '/img/logo_knf.png');
  });


  it('"Prezentacijos" leads to the presentations', async () => {
    const { user } = renderNavbar('/sha256');
    const link = within(navbar()).getByRole('link', { name: 'Prezentacijos' });
    expect(link).toHaveAttribute('href', '/presentations');
    await user.click(link);
    expect(currentPath()).toBe('/presentations');
  });


  it('"Kiti įrankiai" opens a menu of the teaching tools', async () => {
    const { user } = renderNavbar();
    const button = within(navbar()).getByRole('button', { name: 'Kiti įrankiai' });
    expect(button).toHaveAttribute('aria-haspopup', 'true');
    expect(button).not.toHaveAttribute('aria-expanded');

    await user.click(button);
    const menu = await screen.findByRole('menu', { name: 'Kiti įrankiai' });
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(button).toHaveAttribute('aria-controls', 'tools-menu');
    expect(within(menu).getAllByRole('menuitem').map((item) => [item.textContent, item.getAttribute('href')])).toEqual([
      ['DAPPS serveris', '/dapps-server'],
      ['Blokų grandinės simuliatorius', '/sha256'],
    ]);
  });


  it.each([
    ['DAPPS serveris', '/dapps-server'],
    ['Blokų grandinės simuliatorius', '/sha256'],
  ])('the tool "%s" leads to %s and the menu closes', async (name, path) => {
    const { user } = renderNavbar();
    await user.click(within(navbar()).getByRole('button', { name: 'Kiti įrankiai' }));
    await user.click(await screen.findByRole('menuitem', { name }));
    expect(currentPath()).toBe(path);
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });


  it('Escape closes the tools menu, going nowhere', async () => {
    const { user } = renderNavbar();
    await user.click(within(navbar()).getByRole('button', { name: 'Kiti įrankiai' }));
    await screen.findByRole('menu');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(currentPath()).toBe('/presentations');
  });
});







// -----------------------------------------------------------
// On a faucet page
// -----------------------------------------------------------

describe('Navbar — on a faucet page', () => {

  it('shows the family switch — every live family in navbar order, the URL\'s pressed — and the picker', async () => {
    renderNavbar('/faucet/evm/sepolia');
    expect(await pickerShows('Ethereum Sepolia')).toBeInTheDocument();
    expect(segments()).toEqual([['UTXO', 'false'], ['EVM', 'true'], ['ERC-20', 'false'], ['SVM', 'false'], ['MoveVM', 'false']]);
    expect(within(navbar()).queryByRole('button', { name: "Atidaryti faucet'ą" })).toBeNull();
  });


  it.each(FAMILY_URLS)('knows the %s family from its URL (%s): %s pressed, the picker on %s', async (_, route, caption, pick) => {
    renderNavbar(route);
    expect(await pickerShows(pick)).toBeInTheDocument();
    expect(segment(caption)).toHaveAttribute('aria-pressed', 'true');
  });


  it('has a URL case above for every family of FAUCET_TYPES', () => {
    expect(FAMILY_URLS.map(([family]) => family)).toEqual(EVERY_FAMILY);
  });


  it('a path that only looks like a family (/faucet/evmx/…) is no faucet page to the bar', async () => {
    renderNavbar('/faucet/evmx/sepolia');
    await waitFor(() => expect(quickOpen()).toBeEnabled());
    expect(within(navbar()).queryByRole('group')).toBeNull();
  });


  it.each([
    ['/faucet/erc20', 'Pasirinkti žetoną'],
    ['/faucet/evm', 'Pasirinkti tinklą'],
  ])('labels the picker by what the family is keyed by while the URL (%s) names no pick', async (route, placeholder) => {
    renderNavbar(route);
    expect(await pickerShows(placeholder)).toBeInTheDocument();
  });


  it('a segment jumps to that family\'s backend default', async () => {
    const { user } = renderNavbar('/faucet/evm/sepolia');
    await pickerShows('Ethereum Sepolia');
    await user.click(segment('UTXO'));
    expect(currentPath()).toBe('/faucet/utxo/btc4');
  });


  it('…or to the student\'s last pick there, while the catalog still lists it', async () => {
    rememberPick('utxo', 'knf');
    const { user } = renderNavbar('/faucet/evm/sepolia');
    await pickerShows('Ethereum Sepolia');
    await user.click(segment('UTXO'));
    expect(currentPath()).toBe('/faucet/utxo/knf');
  });


  it('…never to a remembered pick the catalog no longer lists', async () => {
    rememberPick('utxo', 'dogecoin');
    const { user } = renderNavbar('/faucet/evm/sepolia');
    await pickerShows('Ethereum Sepolia');
    await user.click(segment('UTXO'));
    expect(currentPath()).toBe('/faucet/utxo/btc4');
  });


  it('…and to the first entry (by id) when the backend default is gone too', async () => {
    given.json('get', '/api/faucet/catalog', catalogWith({ utxo: { ...f.utxoNetworks, default_network: 'dogecoin' } }));
    const { user } = renderNavbar('/faucet/evm/sepolia');
    await pickerShows('Ethereum Sepolia');
    await user.click(segment('UTXO'));
    expect(currentPath()).toBe('/faucet/utxo/knf');
  });


  it('a token family jumps to its default TOKEN', async () => {
    const { user } = renderNavbar('/faucet/evm/sepolia');
    await pickerShows('Ethereum Sepolia');
    await user.click(segment('ERC-20'));
    expect(currentPath()).toBe('/faucet/erc20/LINK');
  });


  it('a segment clicked while the catalog is in flight goes nowhere — never to a dead page', async () => {
    given.hang('get', '/api/faucet/catalog');
    const { user } = renderNavbar('/faucet/evm/sepolia');
    await user.click(segment('UTXO'));
    expect(currentPath()).toBe('/faucet/evm/sepolia');
  });


  it('the pressed segment is inert — a click stays on the page', async () => {
    const { user } = renderNavbar('/faucet/evm/hoodi');
    await pickerShows('Ethereum Hoodi');
    await user.click(segment('EVM'));
    expect(currentPath()).toBe('/faucet/evm/hoodi');
    expect(segment('EVM')).toHaveAttribute('aria-pressed', 'true');
  });


  it('the highlight and the picker follow the URL', async () => {
    const { user } = renderNavbar('/faucet/evm/sepolia');
    await pickerShows('Ethereum Sepolia');
    await user.click(segment('SVM'));
    expect(await pickerShows('Solana Devnet')).toBeInTheDocument();
    expect(segment('SVM')).toHaveAttribute('aria-pressed', 'true');
    expect(segment('EVM')).toHaveAttribute('aria-pressed', 'false');
  });


  it('the picker lists the URL family\'s entries', async () => {
    const { user } = renderNavbar('/faucet/utxo/btc4');
    await user.click(await pickerShows('Bitcoin Testnet4'));
    const menu = await screen.findByRole('menu');
    expect(within(menu).getAllByRole('menuitem').map((row) => row.querySelector('p').textContent)).toEqual(['KNF Coin', 'Litecoin Testnet4', 'Bitcoin Testnet4']);
  });
});







// -----------------------------------------------------------
// Away from the faucets
// -----------------------------------------------------------

describe('Navbar — away from the faucets', () => {

  it('offers "Atidaryti faucet\'ą" instead of the switch', async () => {
    renderNavbar('/sha256');
    await waitFor(() => expect(quickOpen()).toBeEnabled());
    expect(within(navbar()).queryByRole('group')).toBeNull();
  });


  it('keeps the button disabled while the catalog is in flight', async () => {
    given.hang('get', '/api/faucet/catalog');
    renderNavbar();
    expect(quickOpen()).toBeDisabled();
  });


  it('opens the EVM faucet by default — at the backend default', async () => {
    const { user } = renderNavbar();
    await waitFor(() => expect(quickOpen()).toBeEnabled());
    await user.click(quickOpen());
    expect(currentPath()).toBe('/faucet/evm/sepolia');
  });


  it('opens the student\'s last EVM pick', async () => {
    rememberPick('evm', 'hoodi');
    const { user } = renderNavbar();
    await waitFor(() => expect(quickOpen()).toBeEnabled());
    await user.click(quickOpen());
    expect(currentPath()).toBe('/faucet/evm/hoodi');
  });


  it('leads back to the family the student was on last', async () => {
    const { user } = renderNavbar('/faucet/svm/solanaDevnet');
    await pickerShows('Solana Devnet');
    await user.click(within(navbar()).getByRole('link', { name: 'Prezentacijos' }));
    expect(currentPath()).toBe('/presentations');

    await user.click(quickOpen());
    expect(currentPath()).toBe('/faucet/svm/solanaDevnet');
  });


  it('opens the first live family when EVM is disabled', async () => {
    given.json('get', '/api/faucet/catalog', catalogWithout('evm'));
    const { user } = renderNavbar();
    await waitFor(() => expect(quickOpen()).toBeEnabled());
    await user.click(quickOpen());
    expect(currentPath()).toBe('/faucet/utxo/btc4');
  });


  it('stays disabled when no family is configured at all', async () => {
    const seen = given.capture('get', '/api/faucet/catalog', catalogWithout(...EVERY_FAMILY));
    renderNavbar();
    await waitFor(() => expect(seen).toHaveLength(1));
    await waitFor(() => expect(localStorage.getItem(CATALOG_CACHE_KEY)).not.toBeNull());
    expect(quickOpen()).toBeDisabled();
  });
});







// -----------------------------------------------------------
// The catalog
// -----------------------------------------------------------

describe('Navbar — the catalog', () => {

  it('shows every family while the catalog is in flight — the switch never rebuilds on a cold load', async () => {
    given.hang('get', '/api/faucet/catalog');
    renderNavbar('/faucet/evm/sepolia');
    expect(captions()).toEqual(ALL_CAPTIONS);
    expect(await pickerShows('sepolia')).toBeInTheDocument();
  });


  it('hides the families the operator disabled', async () => {
    given.json('get', '/api/faucet/catalog', catalogWithout('svm', 'move'));
    renderNavbar('/faucet/evm/sepolia');
    await pickerShows('Ethereum Sepolia');
    expect(captions()).toEqual(['UTXO', 'EVM', 'ERC-20']);
  });


  it('says so when the URL leads into a disabled family, with the way to a live faucet', async () => {
    given.json('get', '/api/faucet/catalog', catalogWithout('move'));
    renderNavbar('/faucet/move/suiTestnet');
    expect(await within(navbar()).findByText("Šis faucet'as šiuo metu išjungtas")).toBeInTheDocument();
    expect(within(navbar()).getByRole('link', { name: "Į kitą faucet'ą" })).toHaveAttribute('href', '/');
    expect(within(navbar()).queryByRole('group')).toBeNull();
  });


  it('"Į kitą faucet\'ą" leads to "/", which picks a live faucet', async () => {
    given.json('get', '/api/faucet/catalog', catalogWithout('move'));
    const { user } = renderNavbar('/faucet/move/suiTestnet');
    await user.click(await within(navbar()).findByRole('link', { name: "Į kitą faucet'ą" }));
    expect(currentPath()).toBe('/');
  });


  it.each([
    ['a faucet page', '/faucet/evm/sepolia'],
    ['any other page', '/presentations'],
  ])('says the list is unreachable, on %s, when the fetch failed with nothing remembered', async (_, route) => {
    given.error('get', '/api/faucet/catalog', 'Vidinė serverio klaida', 500);
    renderNavbar(route);
    expect(await within(navbar()).findByText("Faucet'ų sąrašas nepasiekiamas")).toBeInTheDocument();
    // The reason beside it — here the backend's own sentence
    expect(within(navbar()).getByText('Vidinė serverio klaida')).toBeInTheDocument();
    expect(within(navbar()).getByRole('button', { name: 'Bandyti dar kartą' })).toBeInTheDocument();
    expect(within(navbar()).queryByRole('group')).toBeNull();
    expect(within(navbar()).queryByRole('button', { name: "Atidaryti faucet'ą" })).toBeNull();
  });


  it('a dropped connection is a failure too, said as such', async () => {
    given.networkError('get', '/api/faucet/catalog');
    renderNavbar('/faucet/evm/sepolia');
    expect(await within(navbar()).findByText("Faucet'ų sąrašas nepasiekiamas")).toBeInTheDocument();
    expect(within(navbar()).getByText('Patikrinkite interneto ryšį.')).toBeInTheDocument();
  });


  it("names the status of a proxy's error page beside the notice", async () => {
    given.html('get', '/api/faucet/catalog');
    renderNavbar('/faucet/evm/sepolia');
    expect(await within(navbar()).findByText('Serveris grąžino klaidą (502).')).toBeInTheDocument();
  });


  it('"Bandyti dar kartą" asks again, and the bar comes back', async () => {
    given.sequence('get', '/api/faucet/catalog', [{ status: 500, body: { error: 'Vidinė serverio klaida' } }, { body: f.catalog }]);
    const { user } = renderNavbar('/faucet/evm/sepolia');
    await user.click(await within(navbar()).findByRole('button', { name: 'Bandyti dar kartą' }));
    expect(await pickerShows('Ethereum Sepolia')).toBeInTheDocument();
    expect(captions()).toEqual(ALL_CAPTIONS);
    expect(within(navbar()).queryByText("Faucet'ų sąrašas nepasiekiamas")).toBeNull();
  });


  it('a retry that fails again keeps the notice', async () => {
    const seen = given.capture('get', '/api/faucet/catalog', { error: 'Vidinė serverio klaida' }, { status: 500 });
    const { user } = renderNavbar('/faucet/evm/sepolia');
    await user.click(await within(navbar()).findByRole('button', { name: 'Bandyti dar kartą' }));
    await waitFor(() => expect(seen).toHaveLength(2));
    expect(await within(navbar()).findByText("Faucet'ų sąrašas nepasiekiamas")).toBeInTheDocument();
    expect(within(navbar()).getByRole('button', { name: 'Bandyti dar kartą' })).toBeEnabled();
  });


  it('remembers the catalog it got for the next load', async () => {
    renderNavbar('/faucet/evm/sepolia');
    await pickerShows('Ethereum Sepolia');
    await waitFor(() => expect(JSON.parse(localStorage.getItem(CATALOG_CACHE_KEY))).toEqual(f.catalog));
  });


  it('draws the remembered catalog at once, before the fetch answers', async () => {
    rememberCatalog(catalogWithout('move'));
    given.hang('get', '/api/faucet/catalog');
    renderNavbar('/faucet/evm/sepolia');
    expect(await pickerShows('Ethereum Sepolia')).toBeInTheDocument();
    expect(captions()).toEqual(['UTXO', 'EVM', 'ERC-20', 'SVM']);
  });


  it('still asks the backend at once, and a fresh answer replaces the remembered one', async () => {
    rememberCatalog(catalogWithout('utxo'));
    renderNavbar('/faucet/evm/sepolia');
    await waitFor(() => expect(captions()).toEqual(ALL_CAPTIONS));
    expect(JSON.parse(localStorage.getItem(CATALOG_CACHE_KEY))).toEqual(f.catalog);
  });


  it('keeps the remembered catalog through a failed refresh — no failure notice', async () => {
    rememberCatalog(f.catalog);
    const seen = given.capture('get', '/api/faucet/catalog', { error: 'Vidinė serverio klaida' }, { status: 500 });
    renderNavbar('/faucet/evm/sepolia');
    await waitFor(() => expect(seen).toHaveLength(1));
    expect(await pickerShows('Ethereum Sepolia')).toBeInTheDocument();
    expect(captions()).toEqual(ALL_CAPTIONS);
    expect(within(navbar()).queryByText("Faucet'ų sąrašas nepasiekiamas")).toBeNull();
  });


  it('ignores a remembered catalog of an older version (catalog:v1)', async () => {
    localStorage.setItem('catalog:v1', JSON.stringify(f.catalog));
    given.hang('get', '/api/faucet/catalog');
    renderNavbar('/faucet/evm/sepolia');
    // still loading: the picker knows only the URL's key
    expect(await pickerShows('sepolia')).toBeInTheDocument();
  });


  it('ignores a corrupt remembered catalog and loads the fresh one', async () => {
    rememberCatalog('{nebe json');
    renderNavbar('/faucet/evm/sepolia');
    expect(await pickerShows('Ethereum Sepolia')).toBeInTheDocument();
  });


  it('works with the storage blocked: nothing read, nothing written, the bar still loads', async () => {
    const blocked = () => {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    };
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(blocked);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(blocked);
    const { user } = renderNavbar('/faucet/evm/sepolia');
    expect(await pickerShows('Ethereum Sepolia')).toBeInTheDocument();
    await user.click(segment('UTXO'));
    expect(currentPath()).toBe('/faucet/utxo/btc4');
  });
});







// -----------------------------------------------------------
// FAUCET_TYPES
// -----------------------------------------------------------
//
// The table the navbar, the picker and App.jsx's "/" redirect
// all walk: per family its caption, placeholder, and how its
// catalog slice becomes picker items.
// -----------------------------------------------------------

describe('FAUCET_TYPES', () => {

  it('lists the five families in navbar order, with their captions and placeholders', () => {
    expect(FAUCET_TYPES.map(({ key, label, pickLabel }) => [key, label, pickLabel])).toEqual([
      ['utxo', 'UTXO', 'Pasirinkti tinklą'],
      ['evm', 'EVM', 'Pasirinkti tinklą'],
      ['erc20', 'ERC-20', 'Pasirinkti žetoną'],
      ['svm', 'SVM', 'Pasirinkti tinklą'],
      ['move', 'MoveVM', 'Pasirinkti tinklą'],
    ]);
  });


  it('orders a network map by id and names each entry by its full name', () => {
    expect(typeOf('utxo').itemsOf(f.utxoNetworks)).toEqual([
      { key: 'knf', primary: 'KNF Coin', secondary: 'Tinklas: mainnet', icon: '/api/icons/utxo/knf' },
      { key: 'ltc4', primary: 'Litecoin Testnet4', secondary: 'Tinklas: testnet', icon: '/api/icons/utxo/ltc4' },
      { key: 'btc4', primary: 'Bitcoin Testnet4', secondary: 'Tinklas: testnet', icon: '/api/icons/utxo/btc4' },
    ]);
  });


  it('gives each network family its own secondary line', () => {
    expect(typeOf('evm').itemsOf(f.evmNetworks).map((item) => item.secondary)).toEqual(['Chain ID: 11155111', 'Chain ID: 560048', 'Chain ID: 421614']);
    expect(typeOf('svm').itemsOf(f.svmNetworks).map((item) => item.secondary)).toEqual(['5 SOL · devnet']);
    expect(typeOf('move').itemsOf(f.moveNetworks).map((item) => item.secondary)).toEqual(['0.5 SUI · testnet']);
  });


  it('falls back to the key for a network without a name, to position 0 without an id, to no icon, to "testnet" without a chain', () => {
    const items = typeOf('utxo').itemsOf({ networks: { second: { id: 2, full_name: 'Antras' }, bare: {} } });
    expect(items).toEqual([
      { key: 'bare', primary: 'bare', secondary: 'Tinklas: testnet', icon: null },
      { key: 'second', primary: 'Antras', secondary: 'Tinklas: testnet', icon: null },
    ]);
  });


  it('keys ERC-20 by TOKEN, in the catalog\'s order, counting the chains each lives on', () => {
    expect(typeOf('erc20').itemsOf(f.catalog.erc20)).toEqual([
      { key: 'FOLD', primary: 'Interfold (FOLD)', secondary: '5 FOLD · 1 tinkl.', icon: '/api/icons/erc20/FOLD' },
      { key: 'LINK', primary: 'Chainlink (LINK)', secondary: '5 LINK · 1 tinkl.', icon: '/api/icons/erc20/LINK' },
    ]);
    const bare = typeOf('erc20').itemsOf({ tokens: { NEW: { name: 'Naujas', symbol: 'NEW', chunk_size: 1 } } });
    expect(bare).toEqual([{ key: 'NEW', primary: 'Naujas (NEW)', secondary: '1 NEW · 0 tinkl.', icon: null }]);
  });


  it('reads the backend\'s suggested pick, or none', () => {
    expect(typeOf('evm').defaultOf(f.evmNetworks)).toBe('sepolia');
    expect(typeOf('erc20').defaultOf(f.catalog.erc20)).toBe('LINK');
    expect(typeOf('evm').defaultOf({ networks: {} })).toBeNull();
    expect(typeOf('erc20').defaultOf({ tokens: {} })).toBeNull();
  });


  it('turns a disabled family (an empty or missing map) into no items', () => {
    for (const type of FAUCET_TYPES) {
      expect(type.itemsOf({}), type.key).toEqual([]);
    }
    expect(typeOf('evm').itemsOf({ networks: {} })).toEqual([]);
    expect(typeOf('erc20').itemsOf({ tokens: {} })).toEqual([]);
  });
});







// -----------------------------------------------------------
// faucetTargetFor
// -----------------------------------------------------------

describe('faucetTargetFor', () => {

  const evm = { items: typeOf('evm').itemsOf(f.evmNetworks), defaultKey: 'hoodi' };


  it('is null for a family with no entries — disabled or still loading — so no jump happens', () => {
    rememberPick('evm', 'sepolia');
    expect(faucetTargetFor({ items: [], defaultKey: 'sepolia' }, 'evm')).toBeNull();
  });


  it('picks the student\'s last pick first, while the catalog lists it', () => {
    rememberPick('evm', 'arbitrumSepolia');
    expect(faucetTargetFor(evm, 'evm')).toBe('arbitrumSepolia');
  });


  it('then the backend default', () => {
    expect(faucetTargetFor(evm, 'evm')).toBe('hoodi');
    rememberPick('evm', 'removedNetwork');
    expect(faucetTargetFor(evm, 'evm')).toBe('hoodi');
  });


  it('then the first entry', () => {
    expect(faucetTargetFor({ ...evm, defaultKey: null }, 'evm')).toBe('sepolia');
    expect(faucetTargetFor({ ...evm, defaultKey: 'removedNetwork' }, 'evm')).toBe('sepolia');
  });


  it('reads only its own family\'s last pick', () => {
    rememberPick('utxo', 'arbitrumSepolia');
    expect(faucetTargetFor(evm, 'evm')).toBe('hoodi');
  });


  it('falls through to the default when the storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    });
    expect(faucetTargetFor(evm, 'evm')).toBe('hoodi');
  });
});







// -----------------------------------------------------------
// useFaucetCatalogs
// -----------------------------------------------------------

describe('useFaucetCatalogs', () => {

  const renderCatalogs = () => {
    const client = makeQueryClient();
    const wrapper = ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    return renderHook(() => useFaucetCatalogs(), { wrapper });
  };


  it('loads, then hands every family its items and default', async () => {
    const { result } = renderCatalogs();
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.failed).toBe(false);
    expect(Object.keys(result.current.families)).toEqual(['utxo', 'evm', 'erc20', 'svm', 'move']);
    expect(result.current.families.evm.defaultKey).toBe('sepolia');
    expect(result.current.families.erc20.items.map((item) => item.key)).toEqual(['FOLD', 'LINK']);
    expect(result.current.families.move.items.map((item) => item.key)).toEqual(['suiTestnet']);
  });


  it('reports a disabled family as empty, not failed', async () => {
    given.json('get', '/api/faucet/catalog', catalogWithout('svm'));
    const { result } = renderCatalogs();
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.failed).toBe(false);
    expect(result.current.families.svm).toEqual({ items: [], defaultKey: null });
  });


  it('reports a fetch that failed with nothing remembered as failed — every family empty — and refetch recovers', async () => {
    given.sequence('get', '/api/faucet/catalog', [{ status: 500, body: { error: 'Vidinė serverio klaida' } }, { body: f.catalog }]);
    const { result } = renderCatalogs();
    await waitFor(() => expect(result.current.failed).toBe(true));
    for (const key of EVERY_FAMILY) expect(result.current.families[key].items, key).toEqual([]);

    await result.current.refetch();
    await waitFor(() => expect(result.current.failed).toBe(false));
    expect(result.current.families.evm.items).toHaveLength(3);
  });


  it('is not failed while a remembered copy stands in — also once the refresh has failed', async () => {
    rememberCatalog(f.catalog);
    const seen = given.capture('get', '/api/faucet/catalog', { error: 'Vidinė serverio klaida' }, { status: 500 });
    const { result } = renderCatalogs();
    expect(result.current.loading).toBe(false);
    expect(result.current.families.evm.items).toHaveLength(3);

    await waitFor(() => expect(seen).toHaveLength(1));
    await settle(50);
    expect(result.current.failed).toBe(false);
    expect(result.current.families.evm.items).toHaveLength(3);
  });


  it('ignores unknown families in the payload', async () => {
    given.json('get', '/api/faucet/catalog', { ...f.catalog, cosmos: { default_network: 'x', networks: { x: { id: 1 } } } });
    const { result } = renderCatalogs();
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(Object.keys(result.current.families)).toEqual(['utxo', 'evm', 'erc20', 'svm', 'move']);
  });
});







// -----------------------------------------------------------
// Backend contract — GET /api/faucet/catalog
// -----------------------------------------------------------
//
// The navbar on the EVM faucet page. Loaded: the picker names
// the network from the catalog (while loading it only knows
// the URL's key). A failure: the unreachable notice with its
// retry. Whatever the body, the bar's fixed parts stand.
// -----------------------------------------------------------

describeEndpointContract({
  path: '/api/faucet/catalog',
  fixture: f.catalog,
  render: () => renderNavbar('/faucet/evm/sepolia'),
  chrome: () => within(navbar()).getByRole('link', { name: 'VU Kauno fakultetas' }) && within(navbar()).getByRole('button', { name: 'Kiti įrankiai' }),
  loaded: async () => {
    expect(await pickerShows('Ethereum Sepolia')).toBeInTheDocument();
  },
  failed: async () => {
    expect(await within(navbar()).findByText("Faucet'ų sąrašas nepasiekiamas")).toBeInTheDocument();
    expect(within(navbar()).getByRole('button', { name: 'Bandyti dar kartą' })).toBeInTheDocument();
  },
  loading: () => within(navbar()).getByRole('button', { name: 'sepolia' }),
});
