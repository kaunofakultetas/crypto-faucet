// -----------------------------------------------------------
//  [*] Tests — EVM transaction graph: naming an address
//
//  The right-click dialog of a node ("Adreso nustatymai"):
//  opened by the canvas's context event on a node (and never
//  the browser's own menu there), prefilled with the node's
//  name, its full read-only address and the "n/64" counter;
//  Išsaugoti sends GET /api/evm/set-address-name?address=
//  &name= (captured — trimmed, URL-encoded, an empty name
//  clears the label), closes the dialog and relabels the node
//  and its table rows in place, and the name outlives the
//  next sweep because the backend now holds it; a failed save
//  keeps the dialog open with what went wrong under the field
//  — the backend's own sentence (a 500, the database refusing
//  the write), or "Nepavyko išsaugoti pavadinimo." with the
//  reason after it (the proxy's HTML page, a dropped
//  connection, a 200 without the backend's OK); Atšaukti, ×
//  and Escape leave without a request; the copy button puts
//  the address on the clipboard with a one-second
//  "Nukopijuota" hint — only when the copy worked, and when it
//  did not, the reason under the address.
// -----------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { given } from '../../support/backend/server';
import { settle } from '../../support/backend/contract';
import { liveNetwork } from '../../support/graph-evm/vis-network';
import { installGraphBackend } from '../../support/graph-evm/backend';
import {
  startGraphSlate, endGraphSlate, advance, renderGraph, bootedNetwork, transferRows, short,
  ADDR, NAMES, DAY_TRANSFERS,
} from '../../support/graph-evm/scene';


vi.mock('vis-network', () => import('../../support/graph-evm/vis-network'));


beforeEach(() => startGraphSlate());
afterEach(() => endGraphSlate());


// What a failed save says under the field: the backend's own
// sentence when it sent one, otherwise the page's with the
// reason after it
const SAVE_FAILED = {
  error: 'Vidinė serverio klaida',
  html: 'Nepavyko išsaugoti pavadinimo. Serveris grąžino klaidą (502).',
  drop: 'Nepavyko išsaugoti pavadinimo. Patikrinkite interneto ryšį.',
  malformed: 'Nepavyko išsaugoti pavadinimo. Serveris atsakė netinkamo formato duomenimis.',
};







// -----------------------------------------------------------
// Helpers
// -----------------------------------------------------------
//
// openFor renders the day's graph and right-clicks a node;
// the dialog's parts by their labels; firstLine is the name
// line of a node's label.
// -----------------------------------------------------------

async function openFor(address, { backend = installGraphBackend({ transfers: DAY_TRANSFERS, addresses: NAMES }) } = {}) {
  const view = renderGraph();
  const network = await bootedNetwork({ transfers: 3 });
  const contextEvent = await network.rightClick(address);
  const dialog = await screen.findByRole('dialog', { name: 'Adreso nustatymai' });
  return { ...view, backend, network, dialog, contextEvent };
}

const nameField = (dialog) => within(dialog).getByRole('textbox', { name: 'Adreso pavadinimas' });
const addressField = (dialog) => within(dialog).getByRole('textbox', { name: 'Adresas' });
const button = (dialog, name) => within(dialog).getByRole('button', { name });

const firstLine = (network, address) => network.node(address).label.split('\n')[0];

const dialogGone = () => waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());







// -----------------------------------------------------------
// Opening the dialog
// -----------------------------------------------------------
//
// A right-click on a node — the canvas's context event.
// -----------------------------------------------------------

describe('Opening the dialog', () => {

  it('a right-click on a node opens "Adreso nustatymai" with its name, its full address and the counter', async () => {
    const { dialog, contextEvent } = await openFor(ADDR.JONAS);
    expect(nameField(dialog)).toHaveValue('Jonas');
    expect(nameField(dialog)).toHaveAccessibleDescription('5/64');
    expect(addressField(dialog)).toHaveValue(ADDR.JONAS);
    expect(addressField(dialog)).toHaveAttribute('readonly');
    expect(button(dialog, 'Išsaugoti')).toBeEnabled();
    expect(button(dialog, 'Atšaukti')).toBeEnabled();
    expect(button(dialog, 'uždaryti')).toBeEnabled();
    expect(button(dialog, 'copy')).toBeEnabled();
    // No browser context menu over the canvas
    expect(contextEvent.defaultPrevented).toBe(true);
  });


  it('an address without a name opens with an empty field and "0/64"', async () => {
    installGraphBackend({ transfers: [...DAY_TRANSFERS, { from: ADDR.FAUCET, to: ADDR.PETRAS, value: 0.2, at: DAY_TRANSFERS[0].at }], addresses: NAMES });
    renderGraph();
    const network = await bootedNetwork({ transfers: 4 });
    await network.rightClick(ADDR.PETRAS);
    const dialog = await screen.findByRole('dialog', { name: 'Adreso nustatymai' });
    expect(nameField(dialog)).toHaveValue('');
    expect(nameField(dialog)).toHaveAccessibleDescription('0/64');
    expect(addressField(dialog)).toHaveValue(ADDR.PETRAS);
  });


  it('a right-click on empty canvas opens nothing, and still no browser menu', async () => {
    installGraphBackend({ transfers: DAY_TRANSFERS, addresses: NAMES });
    renderGraph();
    const network = await bootedNetwork({ transfers: 3 });
    const contextEvent = await network.rightClick(undefined);
    await settle(100);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(contextEvent.defaultPrevented).toBe(true);
  });


  it('the faucet can be named too', async () => {
    const { dialog } = await openFor(ADDR.FAUCET);
    expect(nameField(dialog)).toHaveValue('KNF Faucet');
    expect(addressField(dialog)).toHaveValue(ADDR.FAUCET);
  });
});







// -----------------------------------------------------------
// Saving a name
// -----------------------------------------------------------
//
// Išsaugoti: the request, the dialog closing, the node and
// its rows relabelled in place.
// -----------------------------------------------------------

describe('Saving a name', () => {

  it('Išsaugoti sends the address and the name, closes the dialog and relabels the node in place', async () => {
    const { user, dialog, backend, network } = await openFor(ADDR.JONAS);
    const before = network.node(ADDR.JONAS);
    await user.clear(nameField(dialog));
    await user.type(nameField(dialog), 'Jonas Jonaitis');
    expect(nameField(dialog)).toHaveAccessibleDescription('14/64');
    await user.click(button(dialog, 'Išsaugoti'));

    await dialogGone();
    expect(backend.renames).toEqual([{ address: ADDR.JONAS, name: 'Jonas Jonaitis' }]);
    await waitFor(() => expect(firstLine(network, ADDR.JONAS)).toBe('Jonas Jonaitis'));
    expect(network.node(ADDR.JONAS)).toMatchObject({ x: before.x, y: before.y });
    expect(transferRows()).toEqual([
      ['KNF Faucet', 'Jonas Jonaitis', '0.2000 SepETH (1 tx)'],
      ['KNF Faucet', 'Eglė', '0.2000 SepETH (1 tx)'],
      ['Jonas Jonaitis', 'KNF Faucet', '0.1998 SepETH (1 tx)'],
    ]);
    expect(liveNetwork()).toBe(network);
  });


  it('sends the rename through GET /api/evm/set-address-name with the address and the name in the query', async () => {
    const backend = installGraphBackend({ transfers: DAY_TRANSFERS, addresses: NAMES });
    // Installed after the model, so it answers the rename
    const calls = given.capture('get', '/api/evm/set-address-name', { status: 'OK' });
    const { user, dialog } = await openFor(ADDR.EGLE, { backend });
    await user.clear(nameField(dialog));
    await user.type(nameField(dialog), 'Eglė P.');
    await user.click(button(dialog, 'Išsaugoti'));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].query).toEqual({ address: ADDR.EGLE, name: 'Eglė P.' });
    expect(calls[0].url).toBe(`http://localhost:3000/api/evm/set-address-name?address=${ADDR.EGLE}&name=Egl%C4%97%20P.`);
  });


  it('the new name outlives the next sweep — the backend holds it now', async () => {
    const { user, dialog, network } = await openFor(ADDR.JONAS);
    await user.clear(nameField(dialog));
    await user.type(nameField(dialog), 'Jonukas');
    await user.click(button(dialog, 'Išsaugoti'));
    await dialogGone();
    await advance(3_000);
    await settle(50);
    expect(firstLine(network, ADDR.JONAS)).toBe('Jonukas');
  });


  it('trims the spaces around a name before sending it', async () => {
    const { user, dialog, backend, network } = await openFor(ADDR.JONAS);
    await user.clear(nameField(dialog));
    await user.type(nameField(dialog), '   Jonas J.   ');
    await user.click(button(dialog, 'Išsaugoti'));
    await dialogGone();
    expect(backend.renames).toEqual([{ address: ADDR.JONAS, name: 'Jonas J.' }]);
    expect(firstLine(network, ADDR.JONAS)).toBe('Jonas J.');
  });


  it('sends any typed characters intact — "&", "/", "#", "?" and Lithuanian letters survive the URL', async () => {
    const { user, dialog, backend, network } = await openFor(ADDR.EGLE);
    await user.clear(nameField(dialog));
    await user.type(nameField(dialog), 'Eglė & Co / #1? ąčęėįšųūž=');
    await user.click(button(dialog, 'Išsaugoti'));
    await dialogGone();
    expect(backend.renames).toEqual([{ address: ADDR.EGLE, name: 'Eglė & Co / #1? ąčęėįšųūž=' }]);
    expect(firstLine(network, ADDR.EGLE)).toBe('Eglė & Co / #1? ąčęėįšųūž=');
  });


  it('an empty name clears the label — the node and its rows show the address instead', async () => {
    const { user, dialog, backend, network } = await openFor(ADDR.JONAS);
    await user.clear(nameField(dialog));
    expect(nameField(dialog)).toHaveAccessibleDescription('0/64');
    await user.click(button(dialog, 'Išsaugoti'));
    await dialogGone();
    expect(backend.renames).toEqual([{ address: ADDR.JONAS, name: '' }]);
    await waitFor(() => expect(firstLine(network, ADDR.JONAS)).toBe(short(ADDR.JONAS)));
    expect(transferRows()).toContainEqual(['KNF Faucet', short(ADDR.JONAS), '0.2000 SepETH (1 tx)']);
    // …and it stays cleared: the backend stored ''
    await advance(1_000);
    await settle(50);
    expect(firstLine(network, ADDR.JONAS)).toBe(short(ADDR.JONAS));
  });


  it('a name of spaces only is an empty name', async () => {
    const { user, dialog, backend } = await openFor(ADDR.JONAS);
    await user.clear(nameField(dialog));
    await user.type(nameField(dialog), '     ');
    await user.click(button(dialog, 'Išsaugoti'));
    await dialogGone();
    expect(backend.renames).toEqual([{ address: ADDR.JONAS, name: '' }]);
  });


  it('the field stops at 64 characters and counts them', async () => {
    const { user, dialog, backend } = await openFor(ADDR.JONAS);
    await user.clear(nameField(dialog));
    await user.click(nameField(dialog));
    await user.paste('Ž'.repeat(70));
    expect(nameField(dialog)).toHaveValue('Ž'.repeat(64));
    expect(nameField(dialog)).toHaveAccessibleDescription('64/64');
    await user.click(button(dialog, 'Išsaugoti'));
    await dialogGone();
    expect(backend.renames).toEqual([{ address: ADDR.JONAS, name: 'Ž'.repeat(64) }]);
  });
});







// -----------------------------------------------------------
// When saving fails
// -----------------------------------------------------------
//
// A lost write is shown under the field, saying what went
// wrong; the dialog, the draft and the old label stay.
// -----------------------------------------------------------

describe('When saving fails', () => {

  it.each([
    ['a 500 { error } answer', true, SAVE_FAILED.error],
    ['the proxy\'s HTML 502 page', 'html', SAVE_FAILED.html],
    ['a dropped connection', 'drop', SAVE_FAILED.drop],
  ])('%s keeps the dialog open with what went wrong under the field and the old label', async (_, outage, failure) => {
    const { user, dialog, backend, network } = await openFor(ADDR.JONAS);
    backend.renameOutage = outage;
    await user.clear(nameField(dialog));
    await user.type(nameField(dialog), 'Jonas Jonaitis');
    await user.click(button(dialog, 'Išsaugoti'));

    await waitFor(() => expect(nameField(dialog)).toHaveAccessibleDescription(failure));
    expect(nameField(dialog)).toHaveAttribute('aria-invalid', 'true');
    expect(nameField(dialog)).toHaveValue('Jonas Jonaitis');
    expect(screen.getByRole('dialog', { name: 'Adreso nustatymai' })).toBeInTheDocument();
    expect(firstLine(network, ADDR.JONAS)).toBe('Jonas');
  });


  it('the database refusing the write is said in the backend\'s words', async () => {
    const backend = installGraphBackend({ transfers: DAY_TRANSFERS, addresses: NAMES });
    // Installed after the model, so it answers the rename
    given.error('get', '/api/evm/set-address-name',
      'Nepavyko išsaugoti pavadinimo: duomenų bazė atverta tik skaitymui (attempt to write a readonly database).', 500);
    const { user, dialog, network } = await openFor(ADDR.JONAS, { backend });
    await user.click(button(dialog, 'Išsaugoti'));

    await waitFor(() => expect(nameField(dialog)).toHaveAccessibleDescription(
      'Nepavyko išsaugoti pavadinimo: duomenų bazė atverta tik skaitymui (attempt to write a readonly database).'));
    expect(firstLine(network, ADDR.JONAS)).toBe('Jonas');
  });


  it('a 200 without the backend\'s OK is no saved name — a malformed answer, the dialog stays', async () => {
    const backend = installGraphBackend({ transfers: DAY_TRANSFERS, addresses: NAMES });
    given.text('get', '/api/evm/set-address-name', '<html><body>Prisijunkite prie tinklo</body></html>');
    const { user, dialog, network } = await openFor(ADDR.JONAS, { backend });
    await user.clear(nameField(dialog));
    await user.type(nameField(dialog), 'Jonas Jonaitis');
    await user.click(button(dialog, 'Išsaugoti'));

    await waitFor(() => expect(nameField(dialog)).toHaveAccessibleDescription(SAVE_FAILED.malformed));
    expect(screen.getByRole('dialog', { name: 'Adreso nustatymai' })).toBeInTheDocument();
    expect(firstLine(network, ADDR.JONAS)).toBe('Jonas');
  });


  it('a second try that works closes the dialog and relabels the node', async () => {
    const { user, dialog, backend, network } = await openFor(ADDR.JONAS);
    backend.renameOutage = true;
    await user.clear(nameField(dialog));
    await user.type(nameField(dialog), 'Jonas Jonaitis');
    await user.click(button(dialog, 'Išsaugoti'));
    await waitFor(() => expect(nameField(dialog)).toHaveAccessibleDescription(SAVE_FAILED.error));

    backend.renameOutage = false;
    await user.click(button(dialog, 'Išsaugoti'));
    await dialogGone();
    expect(backend.renames).toHaveLength(2);
    await waitFor(() => expect(firstLine(network, ADDR.JONAS)).toBe('Jonas Jonaitis'));
  });


  it('reopening the dialog starts clean — no old error, the node\'s own name', async () => {
    const { user, dialog, backend, network } = await openFor(ADDR.JONAS);
    backend.renameOutage = true;
    await user.clear(nameField(dialog));
    await user.type(nameField(dialog), 'Jonas Jonaitis');
    await user.click(button(dialog, 'Išsaugoti'));
    await waitFor(() => expect(nameField(dialog)).toHaveAccessibleDescription(SAVE_FAILED.error));
    await user.click(button(dialog, 'Atšaukti'));
    await dialogGone();

    await network.rightClick(ADDR.JONAS);
    const reopened = await screen.findByRole('dialog', { name: 'Adreso nustatymai' });
    expect(nameField(reopened)).toHaveValue('Jonas');
    expect(nameField(reopened)).toHaveAccessibleDescription('5/64');
    expect(nameField(reopened)).not.toHaveAttribute('aria-invalid', 'true');
  });
});







// -----------------------------------------------------------
// Leaving without saving
// -----------------------------------------------------------
//
// Atšaukti, × and Escape: nothing sent, nothing changed, the
// draft dropped.
// -----------------------------------------------------------

describe('Leaving without saving', () => {

  it.each([
    ['Atšaukti', async (user, dialog) => user.click(button(dialog, 'Atšaukti'))],
    ['the × button', async (user, dialog) => user.click(button(dialog, 'uždaryti'))],
    ['Escape', async (user) => user.keyboard('{Escape}')],
  ])('%s closes the dialog without a request and without touching the label', async (_, leave) => {
    const { user, dialog, backend, network } = await openFor(ADDR.JONAS);
    await user.clear(nameField(dialog));
    await user.type(nameField(dialog), 'Nebus išsaugota');
    await leave(user, dialog);
    await dialogGone();
    await settle(50);
    expect(backend.renames).toEqual([]);
    expect(firstLine(network, ADDR.JONAS)).toBe('Jonas');
  });


  it('the dropped draft is gone — reopened, the dialog shows the node\'s name again', async () => {
    const { user, dialog, network } = await openFor(ADDR.JONAS);
    await user.clear(nameField(dialog));
    await user.type(nameField(dialog), 'Juodraštis');
    await user.click(button(dialog, 'Atšaukti'));
    await dialogGone();
    await network.rightClick(ADDR.JONAS);
    expect(nameField(await screen.findByRole('dialog', { name: 'Adreso nustatymai' }))).toHaveValue('Jonas');
  });


  it('right-clicking another node opens the dialog for that one', async () => {
    const { user, dialog, network } = await openFor(ADDR.JONAS);
    await user.click(button(dialog, 'Atšaukti'));
    await dialogGone();
    await network.rightClick(ADDR.EGLE);
    const other = await screen.findByRole('dialog', { name: 'Adreso nustatymai' });
    expect(nameField(other)).toHaveValue('Eglė');
    expect(addressField(other)).toHaveValue(ADDR.EGLE);
  });
});







// -----------------------------------------------------------
// Copying the address
// -----------------------------------------------------------
//
// The copy button: the full address on the clipboard and a
// one-second "Nukopijuota" hint — only when the copy worked;
// a copy the browser would not make is said under the
// address, until the dialog closes.
// -----------------------------------------------------------

describe('Copying the address', () => {

  it('puts the full address on the clipboard and says "Nukopijuota" for a second', async () => {
    const { user, dialog } = await openFor(ADDR.JONAS);
    await user.click(button(dialog, 'copy'));
    expect(await navigator.clipboard.readText()).toBe(ADDR.JONAS);
    expect(await screen.findByRole('tooltip', { name: 'Nukopijuota' })).toBeInTheDocument();

    await advance(1_000);
    await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull());
    expect(screen.getByRole('dialog', { name: 'Adreso nustatymai' })).toBeInTheDocument();
  });


  it('a refused clipboard shows no hint and says why under the address — the browser\'s words kept', async () => {
    const { user, dialog } = await openFor(ADDR.JONAS);
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new DOMException('Write permission denied.', 'NotAllowedError'));
    const logged = vi.spyOn(console, 'error');
    await user.click(button(dialog, 'copy'));
    await waitFor(() => expect(addressField(dialog)).toHaveAccessibleDescription(
      'Nepavyko nukopijuoti adreso: naršyklė neleido įrašyti į iškarpinę (NotAllowedError: Write permission denied.).'));
    expect(addressField(dialog)).toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(logged).toHaveBeenCalledWith('Failed to copy to clipboard:', expect.any(DOMException));
  });


  it('without a clipboard API (a plain-http host) the dialog says so — and the next opening starts clean', async () => {
    const { user, dialog, network } = await openFor(ADDR.JONAS);
    vi.spyOn(navigator, 'clipboard', 'get').mockReturnValue(undefined);
    await user.click(button(dialog, 'copy'));
    await waitFor(() => expect(addressField(dialog)).toHaveAccessibleDescription(
      'Nepavyko nukopijuoti adreso: naršyklė šiame puslapyje iškarpinės nepasiekia — ji veikia tik saugiu (HTTPS) ryšiu.'));

    await user.click(button(dialog, 'Atšaukti'));
    await dialogGone();
    await network.rightClick(ADDR.EGLE);
    const reopened = await screen.findByRole('dialog', { name: 'Adreso nustatymai' });
    expect(addressField(reopened)).not.toHaveAccessibleDescription();
  });
});
