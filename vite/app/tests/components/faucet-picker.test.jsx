// -----------------------------------------------------------
//  [*] Tests — FaucetPicker (the navbar's network / token dropdown)
//
//  The picker on its own, fed the items the navbar feeds it
//  (FAUCET_TYPES' itemsOf over the fixtures' catalog): the
//  trigger naming the pick the URL points at (the URL's key
//  while the catalog loads, the placeholder when the URL names
//  none), the menu of rows with the current one selected, the
//  "Kraunama…" and "Nieko nerasta" rows, the filter (name,
//  secondary line and key; typed letters never stolen by the
//  menu's type-ahead; Escape and Tab close and forget it; the
//  arrows walk the rows), picking (navigate, remember
//  lastPick:<type>, close — also with the storage refusing),
//  and the favourites: the star, the rows floating under a
//  divider, persistence in favFaucetPicks, one namespace per
//  family, a corrupt entry starting fresh.
//
//  Pinned: a favourites entry of the wrong shape (valid JSON
//  that is not a list) crashes the picker — and with it the
//  whole navbar; the first ArrowDown from the filter focuses
//  the filter's invisible wrapper instead of the first row.
// -----------------------------------------------------------

import { describe, it, expect, vi } from 'vitest';
import { act, screen, within, waitFor } from '@testing-library/react';
import { renderPage } from '../support/render';
import { LocationProbe, currentPath } from '../support/shell/router';
import * as f from '../support/backend/fixtures';
import FaucetPicker from '@/components/FaucetPicker';
import { FAUCET_TYPES } from '@/components/Navbar';


const typeOf = (key) => FAUCET_TYPES.find((type) => type.key === key);

// What the navbar hands the picker for each family
const EVM_ITEMS = typeOf('evm').itemsOf(f.evmNetworks);
const UTXO_ITEMS = typeOf('utxo').itemsOf(f.utxoNetworks);
const ERC20_ITEMS = typeOf('erc20').itemsOf(f.catalog.erc20);

const renderPicker = ({ route = '/faucet/evm/sepolia', items = EVM_ITEMS, faucetType = 'evm', label = 'Pasirinkti tinklą', loading = false } = {}) => renderPage(
  <>
    <FaucetPicker items={items} loading={loading} faucetType={faucetType} label={label} />
    <LocationProbe />
  </>,
  { route },
);

// hidden: true — while the menu is open, MUI hides the page
// behind it (the trigger included) from assistive technology
const trigger = (name) => screen.getByRole('button', { name, hidden: true });

const openMenu = async (user, name = 'Ethereum Sepolia') => {
  await user.click(trigger(name));
  return screen.findByRole('menu');
};

const filterField = () => screen.getByPlaceholderText('Filtruoti…');

// Each row as [name, secondary line]; a divider as '—'
const rowsOf = (menu) => [...menu.querySelectorAll('[role="menuitem"], hr')].map((node) => (
  node.tagName === 'HR' ? '—' : [...node.querySelectorAll('p')].map((p) => p.textContent)
));

const rowNamed = (name) => screen.getAllByRole('menuitem').find((row) => within(row).queryByText(name));

const starOf = (name) => within(rowNamed(name)).getByRole('button');

const favourites = () => JSON.parse(localStorage.getItem('favFaucetPicks'));







// -----------------------------------------------------------
// The trigger
// -----------------------------------------------------------

describe('FaucetPicker trigger', () => {

  it('names the network the URL points at and announces its menu', () => {
    renderPicker();
    const button = trigger('Ethereum Sepolia');
    expect(button).toHaveAttribute('aria-haspopup', 'menu');
    expect(button).not.toHaveAttribute('aria-expanded');
    expect(button).not.toHaveAttribute('aria-controls');
  });


  it('carries the picked asset\'s mark', () => {
    renderPicker({ route: '/faucet/evm/hoodi' });
    expect(within(trigger('Ethereum Hoodi')).getByRole('presentation')).toHaveAttribute('src', '/api/icons/evm/hoodi');
  });


  it('shows the URL\'s key while the catalog is still loading', () => {
    renderPicker({ items: [], loading: true });
    expect(trigger('sepolia')).toBeInTheDocument();
  });


  it('shows the URL\'s key for a network the catalog does not list', () => {
    renderPicker({ route: '/faucet/evm/nera' });
    expect(trigger('nera')).toBeInTheDocument();
  });


  it('shows the placeholder when the URL names no pick of its family', () => {
    const { unmount } = renderPicker({ route: '/presentations' });
    expect(trigger('Pasirinkti tinklą')).toBeInTheDocument();
    unmount();

    // Another family's URL names nothing here
    renderPicker({ route: '/faucet/utxo/btc4', items: ERC20_ITEMS, faucetType: 'erc20', label: 'Pasirinkti žetoną' });
    expect(trigger('Pasirinkti žetoną')).toBeInTheDocument();
  });
});







// -----------------------------------------------------------
// The menu
// -----------------------------------------------------------

describe('FaucetPicker menu', () => {

  it('opens on the trigger: every item as a row — name and secondary line, in the order given — the filter focused', async () => {
    const { user } = renderPicker();
    const menu = await openMenu(user);
    expect(trigger('Ethereum Sepolia')).toHaveAttribute('aria-expanded', 'true');
    expect(trigger('Ethereum Sepolia')).toHaveAttribute('aria-controls', 'faucet-picker-menu');
    expect(menu).toHaveAccessibleName('Ethereum Sepolia');
    expect(rowsOf(menu)).toEqual([
      ['Ethereum Sepolia', 'Chain ID: 11155111'],
      ['Ethereum Hoodi', 'Chain ID: 560048'],
      ['Arbitrum Sepolia', 'Chain ID: 421614'],
    ]);
    expect(filterField()).toHaveFocus();
  });


  it('lists a family\'s own secondary lines — UTXO chains by chain, tokens by chunk and chain count', async () => {
    const { user, unmount } = renderPicker({ route: '/faucet/utxo/btc4', items: UTXO_ITEMS, faucetType: 'utxo' });
    expect(rowsOf(await openMenu(user, 'Bitcoin Testnet4'))).toEqual([
      ['KNF Coin', 'Tinklas: mainnet'],
      ['Litecoin Testnet4', 'Tinklas: testnet'],
      ['Bitcoin Testnet4', 'Tinklas: testnet'],
    ]);
    unmount();

    const erc20 = renderPicker({ route: '/faucet/erc20/LINK', items: ERC20_ITEMS, faucetType: 'erc20', label: 'Pasirinkti žetoną' });
    expect(rowsOf(await openMenu(erc20.user, 'Chainlink (LINK)'))).toEqual([
      ['Interfold (FOLD)', '5 FOLD · 1 tinkl.'],
      ['Chainlink (LINK)', '5 LINK · 1 tinkl.'],
    ]);
  });


  it('marks the row of the current pick as selected', async () => {
    const { user } = renderPicker({ route: '/faucet/evm/hoodi' });
    await openMenu(user, 'Ethereum Hoodi');
    expect(rowNamed('Ethereum Hoodi')).toHaveClass('Mui-selected');
    expect(rowNamed('Ethereum Sepolia')).not.toHaveClass('Mui-selected');
  });


  it('says "Kraunama…" while the catalog loads', async () => {
    const { user } = renderPicker({ items: [], loading: true });
    const menu = await openMenu(user, 'sepolia');
    const loadingRow = within(menu).getByRole('menuitem', { name: 'Kraunama…' });
    expect(loadingRow).toHaveAttribute('aria-disabled', 'true');
    expect(within(menu).queryByText('Nieko nerasta')).toBeNull();
  });


  it('says "Nieko nerasta" when there is nothing to list', async () => {
    const { user } = renderPicker({ items: [] });
    const menu = await openMenu(user, 'sepolia');
    expect(within(menu).getByRole('menuitem', { name: 'Nieko nerasta' })).toHaveAttribute('aria-disabled', 'true');
  });


  it('closes on Escape and gives the trigger its closed state back', async () => {
    const { user } = renderPicker();
    await openMenu(user);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(trigger('Ethereum Sepolia')).not.toHaveAttribute('aria-expanded');
  });
});







// -----------------------------------------------------------
// The filter
// -----------------------------------------------------------

describe('FaucetPicker filter', () => {

  it('matches the name, ignoring case', async () => {
    const { user } = renderPicker();
    const menu = await openMenu(user);
    await user.type(filterField(), 'HOODI');
    expect(rowsOf(menu)).toEqual([['Ethereum Hoodi', 'Chain ID: 560048']]);
  });


  it('matches the secondary line and the catalog key, ignoring outer spaces', async () => {
    const { user } = renderPicker();
    const menu = await openMenu(user);
    await user.type(filterField(), '421614');
    expect(rowsOf(menu)).toEqual([['Arbitrum Sepolia', 'Chain ID: 421614']]);

    await user.clear(filterField());
    // only the key reads "arbitrumsepolia" without a space
    await user.type(filterField(), '  arbitrumsep  ');
    expect(rowsOf(menu)).toEqual([['Arbitrum Sepolia', 'Chain ID: 421614']]);
  });


  it('a filter matching nothing says "Nieko nerasta"', async () => {
    const { user } = renderPicker();
    const menu = await openMenu(user);
    await user.type(filterField(), 'dogecoin');
    expect(within(menu).getAllByRole('menuitem').map((row) => row.textContent)).toEqual(['Nieko nerasta']);
  });


  it('keeps every typed letter — the menu\'s type-ahead never steals one, the field keeps the focus', async () => {
    const { user } = renderPicker();
    await openMenu(user);
    await user.type(filterField(), 'ethereum h');
    expect(filterField()).toHaveValue('ethereum h');
    expect(filterField()).toHaveFocus();
  });


  it('Escape closes the menu and forgets the filter', async () => {
    const { user } = renderPicker();
    await openMenu(user);
    await user.type(filterField(), 'hoo');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());

    const menu = await openMenu(user);
    expect(filterField()).toHaveValue('');
    expect(rowsOf(menu)).toHaveLength(3);
  });


  it('Tab closes the menu too', async () => {
    const { user } = renderPicker();
    await openMenu(user);
    await user.keyboard('{Tab}');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });


  it('the arrows walk the rows, and Enter picks the focused one', async () => {
    const { user } = renderPicker();
    await openMenu(user);
    act(() => rowNamed('Ethereum Sepolia').focus());
    await user.keyboard('{ArrowDown}');
    expect(rowNamed('Ethereum Hoodi')).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(rowNamed('Arbitrum Sepolia')).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(currentPath()).toBe('/faucet/evm/arbitrumSepolia');
  });


  it.fails('one ArrowDown from the filter reaches the first row — PINNED KNOWN BUG: MenuList makes the filter\'s wrapper its tab stop (ItemRow hides `selected` from it), so the first ArrowDown focuses an invisible box', async () => {
    const { user } = renderPicker();
    await openMenu(user);
    expect(filterField()).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(rowNamed('Ethereum Sepolia')).toHaveFocus();
  });
});







// -----------------------------------------------------------
// Picking
// -----------------------------------------------------------

describe('FaucetPicker picking', () => {

  it('a row leads to /faucet/<type>/<key>, is remembered as lastPick:<type>, and the menu closes', async () => {
    const { user } = renderPicker();
    await openMenu(user);
    await user.click(rowNamed('Ethereum Hoodi'));
    expect(currentPath()).toBe('/faucet/evm/hoodi');
    expect(localStorage.getItem('lastPick:evm')).toBe('hoodi');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(trigger('Ethereum Hoodi')).toBeInTheDocument();
  });


  it('remembers per family: a token pick lands in lastPick:erc20 only', async () => {
    const { user } = renderPicker({ route: '/faucet/erc20/LINK', items: ERC20_ITEMS, faucetType: 'erc20', label: 'Pasirinkti žetoną' });
    await openMenu(user, 'Chainlink (LINK)');
    await user.click(rowNamed('Interfold (FOLD)'));
    expect(currentPath()).toBe('/faucet/erc20/FOLD');
    expect(localStorage.getItem('lastPick:erc20')).toBe('FOLD');
    expect(localStorage.getItem('lastPick:evm')).toBeNull();
  });


  it('the current row keeps the page and closes the menu', async () => {
    const { user } = renderPicker();
    await openMenu(user);
    await user.click(rowNamed('Ethereum Sepolia'));
    expect(currentPath()).toBe('/faucet/evm/sepolia');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });


  it('still leads there when the storage refuses to remember the pick', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    });
    const { user } = renderPicker();
    await openMenu(user);
    await user.click(rowNamed('Arbitrum Sepolia'));
    expect(currentPath()).toBe('/faucet/evm/arbitrumSepolia');
  });
});







// -----------------------------------------------------------
// Favourites
// -----------------------------------------------------------
//
// Stored as <type>:<key> under favFaucetPicks — catalog keys
// are only unique within a family.
// -----------------------------------------------------------

describe('FaucetPicker favourites', () => {

  it('every row offers an unpressed star, "Pridėti į mėgstamus"', async () => {
    const { user } = renderPicker();
    await openMenu(user);
    for (const name of ['Ethereum Sepolia', 'Ethereum Hoodi', 'Arbitrum Sepolia']) {
      expect(starOf(name)).toHaveAccessibleName('Pridėti į mėgstamus');
      expect(starOf(name)).toHaveAttribute('aria-pressed', 'false');
    }
  });


  it('a star floats its row to the top under a divider — without picking it or closing the menu', async () => {
    const { user } = renderPicker();
    const menu = await openMenu(user);
    await user.click(starOf('Arbitrum Sepolia'));

    expect(rowsOf(menu).map((row) => (row === '—' ? row : row[0]))).toEqual(['Arbitrum Sepolia', '—', 'Ethereum Sepolia', 'Ethereum Hoodi']);
    expect(starOf('Arbitrum Sepolia')).toHaveAccessibleName('Pašalinti iš mėgstamų');
    expect(starOf('Arbitrum Sepolia')).toHaveAttribute('aria-pressed', 'true');
    expect(favourites()).toEqual(['evm:arbitrumSepolia']);
    expect(currentPath()).toBe('/faucet/evm/sepolia');
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });


  it('unstarring puts the row back in its place and the divider goes', async () => {
    const { user } = renderPicker();
    const menu = await openMenu(user);
    await user.click(starOf('Arbitrum Sepolia'));
    await user.click(starOf('Arbitrum Sepolia'));
    expect(rowsOf(menu).map((row) => row[0])).toEqual(['Ethereum Sepolia', 'Ethereum Hoodi', 'Arbitrum Sepolia']);
    expect(favourites()).toEqual([]);
  });


  it('draws no divider when every row is a favourite', async () => {
    const { user } = renderPicker();
    const menu = await openMenu(user);
    for (const name of ['Ethereum Sepolia', 'Ethereum Hoodi', 'Arbitrum Sepolia']) await user.click(starOf(name));
    expect(within(menu).queryByRole('separator')).toBeNull();
    expect(favourites()).toHaveLength(3);
  });


  it('favourites come back on the next visit', async () => {
    localStorage.setItem('favFaucetPicks', JSON.stringify(['evm:hoodi']));
    const { user } = renderPicker();
    const menu = await openMenu(user);
    expect(rowsOf(menu).map((row) => (row === '—' ? row : row[0]))).toEqual(['Ethereum Hoodi', '—', 'Ethereum Sepolia', 'Arbitrum Sepolia']);
    expect(starOf('Ethereum Hoodi')).toHaveAttribute('aria-pressed', 'true');
  });


  it('keeps each family\'s stars apart: the UTXO "knf" never stars an EVM chain keyed "knf"', async () => {
    localStorage.setItem('favFaucetPicks', JSON.stringify(['utxo:knf']));
    const evmKnf = [{ key: 'knf', primary: 'KNF EVM', secondary: 'Chain ID: 7', icon: null }, ...EVM_ITEMS];
    const { user } = renderPicker({ route: '/faucet/evm/knf', items: evmKnf });
    await openMenu(user, 'KNF EVM');
    expect(starOf('KNF EVM')).toHaveAttribute('aria-pressed', 'false');

    await user.click(starOf('KNF EVM'));
    expect(favourites()).toEqual(['utxo:knf', 'evm:knf']);
  });


  it('the filter narrows the favourites too', async () => {
    localStorage.setItem('favFaucetPicks', JSON.stringify(['evm:hoodi']));
    const { user } = renderPicker();
    const menu = await openMenu(user);
    await user.type(filterField(), 'arbitrum');
    expect(rowsOf(menu)).toEqual([['Arbitrum Sepolia', 'Chain ID: 421614']]);
  });


  it('a corrupt favourites entry (unreadable JSON) starts fresh', async () => {
    localStorage.setItem('favFaucetPicks', '{nebe json');
    const { user } = renderPicker();
    const menu = await openMenu(user);
    expect(within(menu).queryByRole('separator')).toBeNull();
    await user.click(starOf('Ethereum Hoodi'));
    expect(favourites()).toEqual(['evm:hoodi']);
  });


  it.fails('a favourites entry of the wrong shape (valid JSON, not a list) starts fresh too — PINNED KNOWN BUG: useLocalStorage guards only unreadable JSON; favorites.includes throws and the navbar crashes', async () => {
    // An object map of favourites — what an older build could
    // have left behind
    localStorage.setItem('favFaucetPicks', JSON.stringify({ 'evm:sepolia': true }));
    const { user } = renderPicker();
    const menu = await openMenu(user);
    expect(rowsOf(menu)).toHaveLength(3);
  });


  it('stars still work for the visit when the storage refuses to save them', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    });
    const { user } = renderPicker();
    await openMenu(user);
    await user.click(starOf('Ethereum Hoodi'));
    expect(starOf('Ethereum Hoodi')).toHaveAttribute('aria-pressed', 'true');
  });
});
