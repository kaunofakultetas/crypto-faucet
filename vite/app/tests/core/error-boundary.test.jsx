// -----------------------------------------------------------
//  [*] Tests — ErrorBoundary (the last line before a white screen)
//
//  The boundary on its own, around a child that throws while
//  rendering ON PURPOSE (each such test declares the crash log
//  with allowConsoleErrors — the console guard fails any other
//  test that logs "Render failed:"): the card with its two ways
//  out, the crash logged with the error and the component
//  stack, containment, and resetKey — a new key clears the
//  error, the same key (or none, the navbar's boundary) keeps
//  the card.
//
//  The two buttons, against the window.location double:
//  "Perkrauti" reloads and touches nothing; "Išvalyti
//  įsimintus duomenis ir perkrauti" removes exactly the keys
//  its list names — catalog:*, lastPick:*, favFaucetPicks,
//  graphNodePositions:* — keeps everything else, then reloads,
//  also when the storage refuses.
//
//  Last, the recovery the second button exists for, through
//  the real App: a remembered catalog the navbar cannot read
//  crashes it on EVERY load — a plain reload replays the
//  crash, clearing the remembered data ends it.
//
//  Pinned: the list misses the UTXO graph's saved box
//  positions (utxo-graph-positions:<network>), which the SPA
//  persists too.
// -----------------------------------------------------------

import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { act, screen, within } from '@testing-library/react';
import { renderPage, renderApp } from '../support/render';
import { allowConsoleErrors } from '../support/setup';
import { installLocationDouble } from '../support/location';
import { CRASH_CARD_TEXT } from '../support/backend/contract';
import { CATALOG_CACHE_KEY, rememberCatalog } from '../support/shell/catalog';
import ErrorBoundary from '@/components/ErrorBoundary';


const RELOAD = 'Perkrauti';
const CLEAR_AND_RELOAD = 'Išvalyti įsimintus duomenis ir perkrauti';

function Boom({ message = 'sugedo' }) {
  throw new Error(message);
}

function MaybeBoom({ explode }) {
  if (explode) throw new Error('sugedo');
  return <p>veikia</p>;
}

// The boundary with props the test changes on the SAME
// instance (a bare rerender would drop renderPage's frame and
// remount it, losing the state under test)
function Host({ initial, control }) {
  const [props, setProps] = useState(initial);
  control.set = (next) => act(() => setProps(next));
  return (
    <ErrorBoundary resetKey={props.resetKey}>
      <MaybeBoom explode={props.explode} />
    </ErrorBoundary>
  );
}

const renderHost = (initial) => {
  const control = {};
  renderPage(<Host initial={initial} control={control} />);
  return control;
};

// What every piece of the SPA remembers, one of each
const SPA_KEYS = {
  'catalog:v2': JSON.stringify({ evm: {} }),
  'lastPick:evm': 'hoodi',
  'lastPick:erc20': 'LINK',
  favFaucetPicks: JSON.stringify(['evm:sepolia']),
  'graphNodePositions:sepolia:2026-09-29': JSON.stringify({ '0xabc': 120 }),
};

const remember = (entries) => Object.entries(entries).forEach(([key, value]) => localStorage.setItem(key, value));

const storedKeys = () => Object.keys(localStorage).sort();







// -----------------------------------------------------------
// Catching
// -----------------------------------------------------------

describe('ErrorBoundary', () => {

  it('renders its children while nothing throws', () => {
    renderPage(<ErrorBoundary><p>veikia</p></ErrorBoundary>);
    expect(screen.getByText('veikia')).toBeInTheDocument();
    expect(screen.queryByText(CRASH_CARD_TEXT)).toBeNull();
  });


  it('replaces a child that throws while rendering with the card and its two ways out', () => {
    allowConsoleErrors(/Render failed:/);
    renderPage(<ErrorBoundary><Boom /></ErrorBoundary>);
    expect(screen.getByText(CRASH_CARD_TEXT)).toBeInTheDocument();
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([RELOAD, CLEAR_AND_RELOAD]);
  });


  it('logs the crash as "Render failed:" with the error and the component stack', () => {
    allowConsoleErrors(/Render failed:/);
    const log = vi.spyOn(console, 'error');
    renderPage(<ErrorBoundary><Boom message="blogas atsakymas" /></ErrorBoundary>);

    const crash = log.mock.calls.find(([first]) => first === 'Render failed:');
    expect(crash).toBeDefined();
    expect(crash[1]).toBeInstanceOf(Error);
    expect(crash[1].message).toBe('blogas atsakymas');
    expect(crash[2]).toMatch(/Boom/);
  });


  it('contains the crash: what sits outside the boundary keeps rendering', () => {
    allowConsoleErrors(/Render failed:/);
    renderPage(
      <>
        <p>virš</p>
        <ErrorBoundary><Boom /></ErrorBoundary>
        <p>po</p>
      </>
    );
    expect(screen.getByText('virš')).toBeInTheDocument();
    expect(screen.getByText('po')).toBeInTheDocument();
    expect(screen.getByText(CRASH_CARD_TEXT)).toBeInTheDocument();
  });


  it('catches a throw from anywhere below, not only its direct child', () => {
    allowConsoleErrors(/Render failed:/);
    renderPage(<ErrorBoundary><div><section><Boom /></section></div></ErrorBoundary>);
    expect(screen.getByText(CRASH_CARD_TEXT)).toBeInTheDocument();
  });


  it('catches a thrown value that is not an Error too', () => {
    allowConsoleErrors(/Render failed:/);
    function ThrowsText() {
      throw 'tik tekstas';
    }
    renderPage(<ErrorBoundary><ThrowsText /></ErrorBoundary>);
    expect(screen.getByText(CRASH_CARD_TEXT)).toBeInTheDocument();
  });
});







// -----------------------------------------------------------
// resetKey
// -----------------------------------------------------------
//
// The page area's boundary is keyed by the route: leaving the
// page that threw recovers. The navbar's has no key.
// -----------------------------------------------------------

describe('ErrorBoundary resetKey', () => {

  it('a new key clears the error and renders the children again', () => {
    allowConsoleErrors(/Render failed:/);
    const host = renderHost({ resetKey: '/dapps-server', explode: true });
    expect(screen.getByText(CRASH_CARD_TEXT)).toBeInTheDocument();

    host.set({ resetKey: '/presentations', explode: false });
    expect(screen.queryByText(CRASH_CARD_TEXT)).toBeNull();
    expect(screen.getByText('veikia')).toBeInTheDocument();
  });


  it('the same key keeps the card, even once the children would render again', () => {
    allowConsoleErrors(/Render failed:/);
    const host = renderHost({ resetKey: '/dapps-server', explode: true });
    host.set({ resetKey: '/dapps-server', explode: false });
    expect(screen.getByText(CRASH_CARD_TEXT)).toBeInTheDocument();
    expect(screen.queryByText('veikia')).toBeNull();
  });


  it('without a key the card stays until the page is reloaded', () => {
    allowConsoleErrors(/Render failed:/);
    const host = renderHost({ explode: true });
    host.set({ explode: false });
    expect(screen.getByText(CRASH_CARD_TEXT)).toBeInTheDocument();
  });


  it('a new key over children that still throw shows the card again, logging the new crash', () => {
    allowConsoleErrors(/Render failed:/);
    const log = vi.spyOn(console, 'error');
    const host = renderHost({ resetKey: '/a', explode: true });
    const crashes = () => log.mock.calls.filter(([first]) => first === 'Render failed:').length;
    expect(crashes()).toBe(1);

    host.set({ resetKey: '/b', explode: true });
    expect(screen.getByText(CRASH_CARD_TEXT)).toBeInTheDocument();
    expect(crashes()).toBe(2);
  });


  it('a new key while nothing is wrong changes nothing', () => {
    const host = renderHost({ resetKey: '/a', explode: false });
    host.set({ resetKey: '/b', explode: false });
    expect(screen.getByText('veikia')).toBeInTheDocument();
  });
});







// -----------------------------------------------------------
// The two buttons
// -----------------------------------------------------------
//
// window.location is the double (installLocationDouble): a
// reload is counted, not performed.
// -----------------------------------------------------------

describe('ErrorBoundary buttons', () => {

  const renderCrashed = () => {
    allowConsoleErrors(/Render failed:/);
    const location = installLocationDouble('/faucet/evm/sepolia');
    const view = renderPage(<ErrorBoundary><Boom /></ErrorBoundary>);
    return { location, ...view };
  };


  it('"Perkrauti" reloads the page once and leaves the remembered data alone', async () => {
    remember(SPA_KEYS);
    const { location, user } = renderCrashed();
    await user.click(screen.getByRole('button', { name: RELOAD }));
    expect(location.reloads).toBe(1);
    expect(location.navigations).toEqual([]);
    expect(storedKeys()).toEqual(Object.keys(SPA_KEYS).sort());
  });


  it('"Išvalyti įsimintus duomenis ir perkrauti" removes everything its list names, then reloads', async () => {
    remember(SPA_KEYS);
    // Every catalog version, every family's last pick
    remember({ 'catalog:v1': '{}', 'lastPick:utxo': 'knf', 'lastPick:svm': 'solanaDevnet', 'graphNodePositions:hoodi:2026-09-01': '{}' });
    const { location, user } = renderCrashed();
    await user.click(screen.getByRole('button', { name: CLEAR_AND_RELOAD }));
    expect(storedKeys()).toEqual([]);
    expect(location.reloads).toBe(1);
  });


  it('keeps whatever is not on its list — other keys, look-alike names, the session storage', async () => {
    remember(SPA_KEYS);
    remember({ 'kita-programa': '1', catalogue: 'panašus, bet ne tas', lastPickup: 'irgi ne tas', theme: 'dark' });
    sessionStorage.setItem('seanso-raktas', 'lieka');
    const { user } = renderCrashed();
    await user.click(screen.getByRole('button', { name: CLEAR_AND_RELOAD }));
    expect(storedKeys()).toEqual(['catalogue', 'kita-programa', 'lastPickup', 'theme']);
    expect(sessionStorage.getItem('seanso-raktas')).toBe('lieka');
  });


  it.fails('also removes the UTXO graph\'s saved box positions — PINNED KNOWN BUG: CACHE_KEY_PREFIXES misses "utxo-graph-positions:", which Graph_UTXO persists', async () => {
    remember({ 'utxo-graph-positions:btc4': JSON.stringify({ [`${'a1'.repeat(32)}`]: { x: 10, y: 20 } }) });
    const { user } = renderCrashed();
    await user.click(screen.getByRole('button', { name: CLEAR_AND_RELOAD }));
    expect(localStorage.getItem('utxo-graph-positions:btc4')).toBeNull();
  });


  it('still reloads when the storage refuses to remove a key', async () => {
    remember(SPA_KEYS);
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    });
    const { location, user } = renderCrashed();
    await user.click(screen.getByRole('button', { name: CLEAR_AND_RELOAD }));
    expect(location.reloads).toBe(1);
  });


  it('still reloads when the storage cannot even be listed (blocked in a private window)', async () => {
    // clear() is what setup.js calls on it after the test
    vi.stubGlobal('localStorage', new Proxy({ clear() {} }, {
      ownKeys() {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      },
    }));
    const { location, user } = renderCrashed();
    await user.click(screen.getByRole('button', { name: CLEAR_AND_RELOAD }));
    expect(location.reloads).toBe(1);
  });
});







// -----------------------------------------------------------
// The recovery it exists for
// -----------------------------------------------------------
//
// The real App at /presentations with a remembered catalog
// the navbar cannot read (a network entry that is null — the
// navbar reads its full_name): the navbar throws on every
// load, before its query could fetch a fresh payload, so only
// clearing the remembered data gets the student out. A
// "reload" here is: the double counts it, the first App goes,
// the real location comes back and a second App boots.
// -----------------------------------------------------------

describe('ErrorBoundary — the stale remembered payload', () => {

  const UNREADABLE_CATALOG = { evm: { default_network: 'sepolia', networks: { sepolia: null } } };

  const bootWithUnreadableCatalog = () => {
    allowConsoleErrors(/Render failed:/);
    rememberCatalog(UNREADABLE_CATALOG);
    const view = renderApp({ route: '/presentations' });
    const location = installLocationDouble('/presentations');
    return { location, ...view };
  };

  const reloadApp = (view) => {
    view.unmount();
    vi.unstubAllGlobals();
    return renderApp({ route: '/presentations' });
  };


  it('crashes the navbar on every load — "Perkrauti" alone replays the crash', async () => {
    const first = bootWithUnreadableCatalog();
    expect(screen.getByText(CRASH_CARD_TEXT)).toBeInTheDocument();

    await first.user.click(screen.getByRole('button', { name: RELOAD }));
    expect(first.location.reloads).toBe(1);
    expect(JSON.parse(localStorage.getItem(CATALOG_CACHE_KEY))).toEqual(UNREADABLE_CATALOG);

    reloadApp(first);
    expect(screen.getByText(CRASH_CARD_TEXT)).toBeInTheDocument();
    expect(screen.queryByRole('navigation')).toBeNull();
  });


  it('clearing the remembered data ends it: the next load builds the navbar from a fresh catalog', async () => {
    const first = bootWithUnreadableCatalog();
    await first.user.click(screen.getByRole('button', { name: CLEAR_AND_RELOAD }));
    expect(first.location.reloads).toBe(1);
    expect(localStorage.getItem(CATALOG_CACHE_KEY)).toBeNull();

    reloadApp(first);
    const navbar = await screen.findByRole('navigation');
    expect(await within(navbar).findByRole('button', { name: "Atidaryti faucet'ą" })).toBeEnabled();
    expect(screen.queryByText(CRASH_CARD_TEXT)).toBeNull();
  });
});
