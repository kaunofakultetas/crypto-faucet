// -----------------------------------------------------------
//  [*] Tests — Bitcoin script playground (route /bitcoin-script)
//
//  The page as a student uses it: two transactions on top,
//  what the spending input brings and the lock in a line with
//  the stack under them, one tray of pieces at the side, and
//  a node whose check is always done and can be walked
//  through.
//
//    - what is on the page when it opens — and how little
//    - the node's check: playing by itself, a step either
//      way, a press on a word, where a refusal is marked
//    - building a script: a press on a piece in the tray, the
//      cross on a tile, the keyboard, and the mouse — a tile
//      carried from the tray to a place in a script, along a
//      script, from script to script, and back out
//    - taking changes back
//    - key pairs: made, used, looked into, renamed, removed
//    - data: read from what is typed, offered plain and
//      hashed, kept on a shelf, refused when it is none
//    - the two transactions: another coin picked, amounts,
//      outputs added and removed, who is paid
//    - the drawer of further settings: time, a coin already
//      spent, signatures that go stale, the redeem script
//    - the scenes and their groups
//    - Lightning and the swaps: a coin held back by its own
//      age, a secret thirty-two bytes long, a second chain
//    - SegWit and Taproot: the rows that come and go with the
//      lock — the witness, a witness script, the script a
//      node builds itself, the scripts a key hides — and the
//      pieces the tray offers for them
//    - the page inside the real app: its route, its tab's
//      title, its place in the tools menu, and that it works
//      with the backend down
//
//  The page asks the backend nothing — a request would fail
//  the test (support/setup.js). jsdom has no layout, so where
//  a dropped tile lands is decided here by giving the tiles
//  of a script a size and a place by hand.
// -----------------------------------------------------------

import { describe, it, expect, vi } from 'vitest';
import { act, createEvent, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { given } from '../../support/backend/server';
import { renderApp, renderPage } from '../../support/render';
import { LIMITS, PLAY_MS } from '@/pages/BitcoinScript/constants';
import { keyFrom, seedKey } from '@/pages/BitcoinScript/engine/keys';
import { EXAMPLES, GROUPS } from '@/pages/BitcoinScript/examples';
import BitcoinScriptPage from '@/pages/BitcoinScript/Page';


// The names of the rows, and of their lists of tiles
const UNLOCK = 'Atrakinimo skriptas';
const LOCK = 'Užrakto skriptas';
const REDEEM = 'Išpirkimo skriptas';
const WITNESS = 'Witness';
const WITNESS_SCRIPT = 'Witness script';
const IMPLIED = 'scriptCode';
const LEAF_A = 'Tapscript A';
const LEAF_B = 'Tapscript B';

// The everyday lock, word by word, as its tiles are named
const P2PKH_LOCK = ['OP_DUP', 'OP_HASH160', 'rakto maiša „Jonas“', 'OP_EQUALVERIFY', 'OP_CHECKSIG'];
const P2PKH_UNLOCK = ['parašas „Jonas“', 'viešasis raktas „Jonas“'];







// -----------------------------------------------------------
// Helpers
// -----------------------------------------------------------
//
// A script is reached by its name; its tiles are the buttons
// in its list, each named for what it holds — the crosses
// that take tiles out are left aside. The stack is read from
// the bottom up, as it is listed. A drag is the four events a
// browser sends, with the pointer put where the test says.
// -----------------------------------------------------------

const open = () => renderPage(<BitcoinScriptPage />);

const rowOf = (name) => screen.getByRole('list', { name });

const wordsOf = (name) => within(rowOf(name)).queryAllByRole('button').map((tile) => tile.getAttribute('aria-label')).filter((label) => !label.startsWith('Išimti: '));

const tileOf = (name, word) => within(rowOf(name)).getByRole('button', { name: word });

const crossOf = (name, word) => within(rowOf(name)).getByRole('button', { name: `Išimti: ${word}` });

const offered = (word) => screen.getByRole('button', { name: `Įdėti: ${word}` });

const stack = () => within(screen.getByRole('list', { name: 'Stekas, nuo apačios į viršų' })).getAllByRole('listitem').map((item) => item.textContent);

const said = () => within(screen.getByRole('region', { name: 'Mazgo patikra' })).getByRole('status').textContent;

const answers = () => within(screen.getByRole('list', { name: 'Mazgo klausimai' })).getAllByRole('listitem').map((item) => item.textContent);

const press = (name) => screen.getByRole('button', { name });

const sceneButton = (label) => within(screen.getByRole('group', { name: 'Scenos' })).getByRole('button', { name: label });

const groupTab = (title) => within(screen.getByRole('group', { name: 'Scenų grupės' })).getByRole('button', { name: title });

const scenesShown = () => within(screen.getByRole('group', { name: 'Scenos' })).getAllByRole('button').map((button) => button.textContent);

const tray = () => screen.getByRole('complementary', { name: 'Detalės' });

const cardOf = (letter) => screen.getByRole('region', { name: `Transakcija ${letter}` });

const coinsOf = (letter) => [...cardOf(letter).querySelectorAll('[data-state]')].map((coin) => coin.dataset.state);

// The tiles of every script get a width of 100 and stand side
// by side from the left edge, so a pointer at x lands in a gap
const giveTilesAPlace = () => vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function place() {
  const index = this.matches?.('[data-slot]') ? [...this.parentElement.querySelectorAll('[data-slot]')].indexOf(this) : -1;
  const left = index === -1 ? 0 : index * 100;
  const size = index === -1 ? 0 : 100;
  return { left, right: left + size, width: size, top: 0, bottom: index === -1 ? 0 : 40, height: index === -1 ? 0 : 40, x: left, y: 0, toJSON: () => ({}) };
});

function send(type, node, x = 0) {
  const event = createEvent[type](node, { dataTransfer: { setData: vi.fn(), effectAllowed: '', dropEffect: '' } });
  Object.defineProperty(event, 'clientX', { value: x });
  Object.defineProperty(event, 'clientY', { value: 10 });
  fireEvent(node, event);
}

function carry(tile, target, x = 0) {
  send('dragStart', tile, x);
  send('dragOver', target, x);
  send('drop', target, x);
  send('dragEnd', tile, x);
}

async function retype(user, field, text) {
  await user.clear(field);
  await user.type(field, text);
}

// A scene of any group: its group's name first, then its button
async function loadScene(user, label) {
  const { group } = EXAMPLES.find((example) => example.label === label);
  await user.click(groupTab(GROUPS.find(({ key }) => key === group).title));
  await user.click(sceneButton(label));
}







// -----------------------------------------------------------
// The page as it opens
// -----------------------------------------------------------

describe('the page as it opens', () => {

  it('shows its title, the locks with the everyday one chosen, and that scene in one sentence', () => {
    open();

    expect(screen.getByRole('heading', { level: 1, name: 'Bitcoin skriptų žaidimų aikštelė' })).toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: 'Scenų grupės' })).getAllByRole('button').map((button) => [button.textContent, button.getAttribute('aria-pressed')])).toEqual(
      GROUPS.map((group) => [group.title, group.key === 'locks' ? 'true' : 'false']),
    );
    expect(within(screen.getByRole('group', { name: 'Scenos' })).getAllByRole('button').map((button) => [button.textContent, button.getAttribute('aria-pressed')])).toEqual([
      ['OP_TRUE', 'false'], ['Suma', 'false'], ['Slaptažodis', 'false'], ['Genesis galvosūkis', 'false'], ['SHA-1 kolizija', 'false'], ['P2PK', 'false'],
      ['P2PKH', 'true'], ['Multisig', 'false'], ['P2SH', 'false'], ['Du keliai', 'false'], ['Vagystė', 'false'], ['OP_RETURN', 'false'],
    ]);
    expect(screen.getByText('Įprasčiausias užraktas: viešojo rakto maiša, tai yra adresas. Atrakina viešasis raktas, atitinkantis maišą, ir jo parašas.')).toBeInTheDocument();
  });


  it('shows transaction A with its two coins, the first one picked', () => {
    open();

    expect(within(cardOf('A')).getAllByRole('radio').map((coin) => [coin.getAttribute('aria-label'), coin.checked])).toEqual([
      ['Išvestis #0: 0.5 BTC, adresas „Jonas“ (P2PKH)', true],
      ['Išvestis #1: 0.3 BTC, adresas „Gabija“ (P2PKH)', false],
    ]);
  });


  it('shows transaction B paying Gabija, and what is left for the miner', () => {
    open();
    const b = cardOf('B');

    expect(within(within(b).getByRole('list', { name: 'Transakcijos B išvestys' })).getAllByRole('listitem')).toHaveLength(1);
    expect(within(b).getByRole('button', { name: 'Transakcijos B išvesties #0 suma: 0.4999 BTC' })).toBeInTheDocument();
    expect(within(b).getByRole('combobox', { name: 'Transakcijos B išvesties #0 gavėjas' })).toHaveDisplayValue('Gabija');
    expect(within(b).getByText('kasėjui 0.0001 BTC')).toBeInTheDocument();
  });


  it('lays the two scripts out as tiles, in the order a node runs them', () => {
    open();

    expect(within(screen.getByRole('region', { name: 'Skriptai' })).getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)).toEqual([UNLOCK, LOCK]);
    expect(wordsOf(UNLOCK)).toEqual(P2PKH_UNLOCK);
    expect(wordsOf(LOCK)).toEqual(P2PKH_LOCK);
    expect(screen.getByText('transakcijos B įvestis')).toBeInTheDocument();
    expect(screen.getByText('transakcijos A išvestis')).toBeInTheDocument();
  });


  it('says what Bitcoin texts call a script when its name is pointed at', async () => {
    const { user } = open();

    await user.hover(screen.getByRole('heading', { level: 2, name: UNLOCK }));
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Bitcoin tekstuose šis skriptas vadinamas scriptSig.');

    await user.hover(screen.getByRole('heading', { level: 2, name: LOCK }));
    await waitFor(() => expect(screen.getByRole('tooltip')).toHaveTextContent('Bitcoin tekstuose šis skriptas vadinamas scriptPubKey.'));
  });


  it('shows the stack and the verdict at once, without a press', () => {
    open();

    expect(stack()).toEqual(['1 (TRUE)']);
    expect(said()).toContain('Transakcija B priimta');
    expect(said()).toContain('Skriptai įvykdyti, steko viršuje — TRUE: užraktas atrakintas.');
    expect(answers()).toEqual(['Moneta: taip', 'Sumos: taip', 'Laikas: taip', 'Skriptai: taip']);
    expect(screen.getByText('atrakinta')).toBeInTheDocument();
  });


  it('draws an accepted transaction as a coin gone from A and a new coin made by B', () => {
    open();

    expect(coinsOf('A')).toEqual(['spent', 'unspent']);
    expect(coinsOf('B')).toEqual(['spent', 'unspent']);
  });


  it('keeps the tray to what this scene needs: its two key pairs, a handful of opcodes, a field for data', () => {
    open();
    const pieces = within(tray());

    expect(pieces.getAllByRole('button', { name: /^Raktų pora „/ }).map((button) => button.getAttribute('aria-label'))).toEqual(['Raktų pora „Jonas“', 'Raktų pora „Gabija“']);
    for (const piece of ['parašas', 'viešasis raktas', 'rakto maiša']) expect(offered(`${piece} „Gabija“`)).toBeInTheDocument();
    for (const word of ['OP_DUP', 'OP_HASH160', 'OP_EQUALVERIFY', 'OP_CHECKSIG', '0', '1', '2', '3']) expect(offered(word)).toBeInTheDocument();
    expect(pieces.queryByRole('button', { name: 'Įdėti: OP_RIPEMD160' })).not.toBeInTheDocument();
    expect(pieces.getByRole('button', { name: 'Visi opkodai' })).toHaveAttribute('aria-expanded', 'false');
    expect(pieces.getByRole('textbox', { name: 'Nauji duomenys' })).toHaveValue('');
    expect(pieces.queryByRole('list', { name: 'Sukurti duomenys' })).not.toBeInTheDocument();
  });


  it('keeps the further settings and every row this lock has no use for out of sight', () => {
    open();

    expect(press('Daugiau nustatymų')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByLabelText('Grandinės aukštis')).not.toBeInTheDocument();
    for (const row of [REDEEM, WITNESS, WITNESS_SCRIPT, IMPLIED, LEAF_A, LEAF_B]) expect(screen.queryByRole('list', { name: row })).not.toBeInTheDocument();
  });
});







// -----------------------------------------------------------
// The node's check
// -----------------------------------------------------------

describe("the node's check", () => {

  it('plays from the first word by itself, the stack filling word by word, and ends on the verdict', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    open();
    fireEvent.click(press('Rodyti žingsniais'));

    expect(press('Stabdyti')).toBeInTheDocument();
    expect(stack()).toEqual(['sig Jonas']);
    expect(said()).toContain('Atrakinimo skriptas: parašas „Jonas“');
    expect(said()).toContain('Ant steko dedama: parašas „Jonas“.');
    expect(screen.getByText('tikrinama')).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(PLAY_MS));
    expect(stack()).toEqual(['sig Jonas', 'pubKey Jonas']);

    act(() => vi.advanceTimersByTime(PLAY_MS));
    act(() => vi.advanceTimersByTime(PLAY_MS));
    expect(stack()).toEqual(['sig Jonas', 'pubKey Jonas', 'pubKeyHash Jonas']);
    expect(tileOf(LOCK, 'OP_HASH160')).toHaveAttribute('aria-current', 'step');

    for (let step = 0; step < 4; step += 1) act(() => vi.advanceTimersByTime(PLAY_MS));
    expect(stack()).toEqual(['1 (TRUE)']);
    expect(said()).toContain('Transakcija B priimta');
    expect(press('Rodyti žingsniais')).toBeInTheDocument();
    expect(screen.getByText('atrakinta')).toBeInTheDocument();
  });


  it('stops where it is when asked', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    open();
    fireEvent.click(press('Rodyti žingsniais'));
    act(() => vi.advanceTimersByTime(PLAY_MS));
    fireEvent.click(press('Stabdyti'));
    for (let step = 0; step < 5; step += 1) act(() => vi.advanceTimersByTime(PLAY_MS));

    expect(stack()).toEqual(['sig Jonas', 'pubKey Jonas']);
    expect(press('Rodyti žingsniais')).toBeInTheDocument();
  });


  it('draws a transaction that is still being checked as a claim: the coin unspent, the new coins not made', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    open();
    fireEvent.click(press('Rodyti žingsniais'));

    expect(coinsOf('A')).toEqual(['unspent', 'unspent']);
    expect(coinsOf('B')).toEqual(['unspent', 'future']);
  });


  it('goes a word back and a word forward by hand', async () => {
    const { user } = open();
    expect(press('Žingsnis pirmyn')).toBeDisabled();

    await user.click(press('Žingsnis atgal'));
    expect(said()).toContain('Užrakto skriptas: OP_CHECKSIG');
    expect(stack()).toEqual(['1 (TRUE)']);

    await user.click(press('Žingsnis atgal'));
    expect(said()).toContain('Užrakto skriptas: OP_EQUALVERIFY');
    expect(said()).toContain('Lyginama: rakto maiša „Jonas“ ir rakto maiša „Jonas“ — sutampa.');
    expect(stack()).toEqual(['sig Jonas', 'pubKey Jonas']);

    await user.click(press('Žingsnis pirmyn'));
    expect(said()).toContain('Užrakto skriptas: OP_CHECKSIG');
  });


  it('goes all the way back to an empty stack and a claim nobody has checked', async () => {
    const { user } = open();
    for (let step = 0; step < 8; step += 1) await user.click(press('Žingsnis atgal'));

    expect(stack()).toEqual(['tuščias']);
    expect(said()).toContain('Stekas tuščias. Mazgas pradeda nuo atrakinimo skripto ir eina per žodžius iš eilės.');
    expect(screen.getByText('nepatikrinta')).toBeInTheDocument();
    expect(press('Žingsnis atgal')).toBeDisabled();
  });


  it('shows the stack a word left behind when that word is pressed', async () => {
    const { user } = open();
    await user.click(tileOf(LOCK, 'OP_HASH160'));

    expect(stack()).toEqual(['sig Jonas', 'pubKey Jonas', 'pubKeyHash Jonas']);
    expect(said()).toContain('Maišoma: viešasis raktas „Jonas“. Gauta: rakto maiša „Jonas“.');
    expect(tileOf(LOCK, 'OP_HASH160')).toHaveAttribute('aria-current', 'step');
    expect(tileOf(LOCK, 'OP_DUP')).not.toHaveAttribute('aria-current');
  });


  it('marks the word a refusal broke at and says what that word found', async () => {
    const { user } = open();
    await user.click(sceneButton('Vagystė'));

    expect(said()).toContain('Transakcija B atmesta');
    expect(said()).toContain('Mazgas sustojo užrakto skripte, ties žodžiu OP_EQUALVERIFY.');
    expect(said()).toContain('Lyginama: rakto maiša „Rokas“ ir rakto maiša „Jonas“ — nesutampa.');
    expect(stack()).toEqual(['sig Rokas', 'pubKey Rokas', 'pubKeyHash Rokas', 'pubKeyHash Jonas']);
    expect(tileOf(LOCK, 'OP_EQUALVERIFY')).toHaveAttribute('aria-current', 'step');
    expect(answers()).toEqual(['Moneta: taip', 'Sumos: taip', 'Laikas: taip', 'Skriptai: ne']);
    expect(screen.getByText('atmesta')).toBeInTheDocument();
    expect(coinsOf('A')).toEqual(['unspent']);
    expect(coinsOf('B')).toEqual(['unspent', 'future']);
  });


  it('has nothing to show for a word the node never got to', async () => {
    const { user } = open();
    await user.click(sceneButton('Vagystė'));
    await user.click(tileOf(LOCK, 'OP_CHECKSIG'));

    expect(said()).toContain('Transakcija B atmesta');
    expect(tileOf(LOCK, 'OP_CHECKSIG')).not.toHaveAttribute('aria-current');
  });


  it('follows the node into the redeem script of a coin locked to a script\'s hash', async () => {
    const { user } = open();
    await user.click(sceneButton('P2SH'));
    for (let step = 0; step < 6; step += 1) await user.click(press('Žingsnis atgal'));

    expect(said()).toContain('Atidaromas išpirkimo skriptas');
    expect(stack()).toEqual(['0 (FALSE)', 'sig Jonas', 'sig Gabija']);

    await user.click(press('Žingsnis pirmyn'));
    expect(said()).toContain('Išpirkimo skriptas: 2');
    expect(within(rowOf(REDEEM)).getAllByRole('button', { name: '2' }).map((tile) => tile.getAttribute('aria-current'))).toEqual(['step', null]);
  });
});







// -----------------------------------------------------------
// Building a script
// -----------------------------------------------------------

describe('building a script', () => {

  it('sends a piece pressed in the tray to the end of the unlocking script, and judges the result at once', async () => {
    const { user } = open();
    await user.click(offered('OP_DUP'));

    expect(wordsOf(UNLOCK)).toEqual([...P2PKH_UNLOCK, 'OP_DUP']);
    expect(wordsOf(LOCK)).toEqual(P2PKH_LOCK);
    expect(said()).toContain('Transakcija B atmesta');
    expect(screen.getByText('atmesta')).toBeInTheDocument();
  });


  it('sends pressed pieces to the script that was pressed last', async () => {
    const { user } = open();
    await user.click(rowOf(LOCK));
    await user.click(offered('OP_DUP'));

    expect(wordsOf(LOCK)).toEqual([...P2PKH_LOCK, 'OP_DUP']);
    expect(wordsOf(UNLOCK)).toEqual(P2PKH_UNLOCK);
  });


  it('opens a lock emptied of its unlocking script, piece by piece', async () => {
    const { user } = open();
    await user.click(sceneButton('Suma'));
    await user.click(press(`Išvalyti: ${UNLOCK}`));

    expect(wordsOf(UNLOCK)).toEqual([]);
    expect(within(rowOf(UNLOCK)).getByText('Tempk detales čia')).toBeInTheDocument();
    expect(said()).toContain('Mazgas sustojo užrakto skripte, ties žodžiu OP_ADD.');
    expect(said()).toContain('Šiam žodžiui reikia 2 steko elementų, o steke yra 0.');

    await user.click(offered('2'));
    await user.click(offered('3'));
    expect(wordsOf(UNLOCK)).toEqual(['2', '3']);
    expect(said()).toContain('Transakcija B priimta');
    expect(stack()).toEqual(['1 (TRUE)']);
  });


  it('takes a tile out by the cross on its corner', async () => {
    const { user } = open();
    await user.click(crossOf(UNLOCK, 'viešasis raktas „Jonas“'));

    expect(wordsOf(UNLOCK)).toEqual(['parašas „Jonas“']);
    expect(said()).toContain('Mazgas sustojo užrakto skripte, ties žodžiu OP_EQUALVERIFY.');
  });


  it('moves a tile along its script with Shift and an arrow, and keeps the keyboard on it', async () => {
    const { user } = open();
    tileOf(UNLOCK, 'viešasis raktas „Jonas“').focus();
    await user.keyboard('{Shift>}{ArrowLeft}{/Shift}');

    expect(wordsOf(UNLOCK)).toEqual(['viešasis raktas „Jonas“', 'parašas „Jonas“']);
    expect(document.activeElement).toBe(tileOf(UNLOCK, 'viešasis raktas „Jonas“'));

    await user.keyboard('{Shift>}{ArrowLeft}{/Shift}');
    expect(wordsOf(UNLOCK)).toEqual(['viešasis raktas „Jonas“', 'parašas „Jonas“']);

    await user.keyboard('{Shift>}{ArrowRight}{/Shift}');
    expect(wordsOf(UNLOCK)).toEqual(P2PKH_UNLOCK);
    expect(said()).toContain('Transakcija B priimta');
  });


  it('takes a tile out with the Delete key and leaves the keyboard on its neighbour', async () => {
    const { user } = open();
    tileOf(LOCK, 'OP_HASH160').focus();
    await user.keyboard('{Delete}');

    expect(wordsOf(LOCK)).toEqual(['OP_DUP', 'rakto maiša „Jonas“', 'OP_EQUALVERIFY', 'OP_CHECKSIG']);
    expect(document.activeElement).toBe(tileOf(LOCK, 'rakto maiša „Jonas“'));
  });


  it('empties a script with one press', async () => {
    const { user } = open();
    await user.click(press(`Išvalyti: ${LOCK}`));

    expect(wordsOf(LOCK)).toEqual([]);
    expect(screen.queryByRole('button', { name: `Išvalyti: ${LOCK}` })).not.toBeInTheDocument();
    expect(within(cardOf('A')).getAllByRole('radio')[0]).toHaveAccessibleName('Išvestis #0: 0.5 BTC, be užrakto');
  });


  it('drops a tile carried from the tray at the place the pointer is over', () => {
    giveTilesAPlace();
    open();
    carry(offered('OP_EQUAL'), rowOf(LOCK), 150);

    expect(wordsOf(LOCK)).toEqual(['OP_DUP', 'OP_HASH160', 'OP_EQUAL', 'rakto maiša „Jonas“', 'OP_EQUALVERIFY', 'OP_CHECKSIG']);
    expect(wordsOf(UNLOCK)).toEqual(P2PKH_UNLOCK);
  });


  it('makes the script a tile was dropped into the one pressed pieces go to', async () => {
    giveTilesAPlace();
    const { user } = open();
    carry(offered('OP_EQUAL'), rowOf(LOCK), 990);
    await user.click(offered('1'));

    expect(wordsOf(LOCK)).toEqual([...P2PKH_LOCK, 'OP_EQUAL', '1']);
  });


  it('moves a tile carried along its own script', () => {
    giveTilesAPlace();
    open();
    carry(tileOf(LOCK, 'OP_CHECKSIG'), rowOf(LOCK), 10);

    expect(wordsOf(LOCK)).toEqual(['OP_CHECKSIG', 'OP_DUP', 'OP_HASH160', 'rakto maiša „Jonas“', 'OP_EQUALVERIFY']);
  });


  it('moves a tile carried from one script into the other', () => {
    giveTilesAPlace();
    open();
    carry(tileOf(UNLOCK, 'viešasis raktas „Jonas“'), rowOf(LOCK), 990);

    expect(wordsOf(UNLOCK)).toEqual(['parašas „Jonas“']);
    expect(wordsOf(LOCK)).toEqual([...P2PKH_LOCK, 'viešasis raktas „Jonas“']);
  });


  it('takes a tile out of its script when it is dropped back on the tray', () => {
    open();
    carry(tileOf(LOCK, 'OP_HASH160'), tray());

    expect(wordsOf(LOCK)).toEqual(['OP_DUP', 'rakto maiša „Jonas“', 'OP_EQUALVERIFY', 'OP_CHECKSIG']);
  });


  it('says on the tray that a tile dropped there is taken out, while one out of a script is in hand', async () => {
    open();
    send('dragStart', tileOf(LOCK, 'OP_HASH160'));

    expect(await screen.findByText('Numesk čia, ir detalė bus išimta')).toBeInTheDocument();

    send('dragEnd', tileOf(LOCK, 'OP_HASH160'));
    expect(screen.queryByText('Numesk čia, ir detalė bus išimta')).not.toBeInTheDocument();
    expect(wordsOf(LOCK)).toEqual(P2PKH_LOCK);
  });


  it('leaves the scripts alone when a piece of the tray is dropped back on the tray', () => {
    open();
    carry(offered('OP_DUP'), tray());

    expect(wordsOf(UNLOCK)).toEqual(P2PKH_UNLOCK);
    expect(wordsOf(LOCK)).toEqual(P2PKH_LOCK);
  });


  it('finds every other opcode behind one press, by family and by a search', async () => {
    const { user } = open();
    await user.click(press('Visi opkodai'));

    expect(within(tray()).getAllByRole('group').map((family) => family.getAttribute('aria-label'))).toEqual(['Skaičiai', 'Stekas', 'Palyginimas', 'Aritmetika', 'Kriptografija', 'Sąlygos ir pabaiga', 'Laikas', 'Išjungti', 'Rezervuoti']);
    expect(offered('OP_RIPEMD160')).toBeInTheDocument();

    await user.type(screen.getByRole('searchbox', { name: 'Ieškoti opkodo' }), 'checklock');
    expect(within(tray()).getAllByRole('group').map((family) => family.getAttribute('aria-label'))).toEqual(['Laikas']);
    await user.click(offered('OP_CHECKLOCKTIMEVERIFY'));
    expect(wordsOf(UNLOCK)).toEqual([...P2PKH_UNLOCK, 'OP_CHECKLOCKTIMEVERIFY']);

    await retype(user, screen.getByRole('searchbox', { name: 'Ieškoti opkodo' }), 'tokio nėra');
    expect(screen.getByText('Tokio opkodo nėra.')).toBeInTheDocument();
  });
});







// -----------------------------------------------------------
// Taking changes back
// -----------------------------------------------------------

describe('taking changes back', () => {

  it('has nothing to take back on a scene just loaded', () => {
    open();

    expect(press('Atšaukti')).toBeDisabled();
  });


  it('takes changes back one at a time, by the button and by Ctrl+Z', async () => {
    const { user } = open();
    await user.click(offered('OP_DUP'));
    await user.click(crossOf(UNLOCK, 'parašas „Jonas“'));
    expect(wordsOf(UNLOCK)).toEqual(['viešasis raktas „Jonas“', 'OP_DUP']);

    await user.click(press('Atšaukti'));
    expect(wordsOf(UNLOCK)).toEqual([...P2PKH_UNLOCK, 'OP_DUP']);

    await user.keyboard('{Control>}z{/Control}');
    expect(wordsOf(UNLOCK)).toEqual(P2PKH_UNLOCK);
    expect(said()).toContain('Transakcija B priimta');
    expect(press('Atšaukti')).toBeDisabled();
  });


  it('counts an amount typed letter by letter as one change', async () => {
    const { user } = open();
    await user.click(press('Transakcijos B išvesties #0 suma: 0.4999 BTC'));
    await retype(user, screen.getByRole('textbox', { name: 'Transakcijos B išvesties #0 suma' }), '0.25{Enter}');
    expect(press('Transakcijos B išvesties #0 suma: 0.25 BTC')).toBeInTheDocument();

    await user.click(press('Atšaukti'));
    expect(press('Transakcijos B išvesties #0 suma: 0.4999 BTC')).toBeInTheDocument();
    expect(press('Atšaukti')).toBeDisabled();
  });


  it('loads the scene afresh, undoing everything and forgetting what could be taken back', async () => {
    const { user } = open();
    await user.click(press('Sukurti raktų porą'));
    await user.click(offered('OP_DUP'));
    await user.click(press('Iš naujo'));

    expect(wordsOf(UNLOCK)).toEqual(P2PKH_UNLOCK);
    expect(within(tray()).getAllByRole('button', { name: /^Raktų pora „/ })).toHaveLength(2);
    expect(said()).toContain('Transakcija B priimta');
    expect(press('Atšaukti')).toBeDisabled();
  });
});







// -----------------------------------------------------------
// Key pairs
// -----------------------------------------------------------

describe('key pairs', () => {

  it('makes a new key pair with its three pieces, and lets transaction B pay it', async () => {
    const { user } = open();
    await user.click(press('Sukurti raktų porą'));

    expect(press('Raktų pora „Eglė“')).toBeInTheDocument();
    for (const piece of ['parašas', 'viešasis raktas', 'rakto maiša']) expect(offered(`${piece} „Eglė“`)).toBeInTheDocument();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Transakcijos B išvesties #0 gavėjas' }), 'Eglė');
    expect(screen.getByRole('combobox', { name: 'Transakcijos B išvesties #0 gavėjas' })).toHaveDisplayValue('Eglė');
    expect(said()).toContain('Transakcija B priimta');
  });


  it('locks a coin to the new key pair and opens it with that pair\'s signature, all by presses', async () => {
    const { user } = open();
    await user.click(press('Sukurti raktų porą'));

    await user.click(press(`Išvalyti: ${LOCK}`));
    for (const word of ['OP_DUP', 'OP_HASH160', 'rakto maiša „Eglė“', 'OP_EQUALVERIFY', 'OP_CHECKSIG']) await user.click(offered(word));
    expect(within(cardOf('A')).getAllByRole('radio')[0]).toHaveAccessibleName('Išvestis #0: 0.5 BTC, adresas „Eglė“ (P2PKH)');
    expect(said()).toContain('Transakcija B atmesta');

    await user.click(press(`Išvalyti: ${UNLOCK}`));
    await user.click(offered('parašas „Eglė“'));
    await user.click(offered('viešasis raktas „Eglė“'));
    expect(said()).toContain('Transakcija B priimta');
    expect(stack()).toEqual(['1 (TRUE)']);
  });


  it('makes no more key pairs than the tray has room for', async () => {
    const { user } = open();
    for (let made = 2; made < LIMITS.KEYS; made += 1) await user.click(press('Sukurti raktų porą'));

    expect(within(tray()).getAllByRole('button', { name: /^Raktų pora „/ })).toHaveLength(LIMITS.KEYS);
    expect(screen.queryByRole('button', { name: 'Sukurti raktų porą' })).not.toBeInTheDocument();
  });


  it('opens what a key pair is: private key, public key, its hash and the address', async () => {
    const { user } = open();
    const jonas = keyFrom(seedKey('Jonas'));
    await user.click(press('Raktų pora „Jonas“'));

    expect(screen.getByRole('textbox', { name: 'Pavadinimas' })).toHaveValue('Jonas');
    for (const term of ['Privatus raktas', 'Viešasis raktas', 'Viešojo rakto maiša (HASH160)', 'Adresas']) expect(screen.getByText(term)).toBeInTheDocument();
    for (const value of [jonas.privateKey, jonas.publicKey, jonas.publicKeyHash, jonas.address]) expect(screen.getByText(value)).toBeInTheDocument();
    expect(jonas.address).toMatch(/^[mn]/);
  });


  it('renames a key pair everywhere at once, and the scripts keep working', async () => {
    const { user } = open();
    await user.click(press('Raktų pora „Jonas“'));
    await retype(user, screen.getByRole('textbox', { name: 'Pavadinimas' }), 'Petras');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Pavadinimas' })).not.toBeInTheDocument());

    expect(press('Raktų pora „Petras“')).toBeInTheDocument();
    expect(wordsOf(UNLOCK)).toEqual(['parašas „Petras“', 'viešasis raktas „Petras“']);
    expect(within(cardOf('A')).getAllByRole('radio')[0]).toHaveAccessibleName('Išvestis #0: 0.5 BTC, adresas „Petras“ (P2PKH)');
    expect(stack()).toEqual(['1 (TRUE)']);
    expect(said()).toContain('Transakcija B priimta');
  });


  it('removes a key pair, hands its coin in B to the pair that is left, and keeps the last pair', async () => {
    const { user } = open();
    await user.click(press('Raktų pora „Gabija“'));
    await user.click(press('Pašalinti raktų porą'));

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Raktų pora „Gabija“' })).not.toBeInTheDocument());
    expect(screen.getByRole('combobox', { name: 'Transakcijos B išvesties #0 gavėjas' })).toHaveDisplayValue('Jonas');

    await user.click(press('Raktų pora „Jonas“'));
    expect(press('Pašalinti raktų porą')).toBeDisabled();
  });


  it('stops the check when a removed key pair is still named in a script, and says so', async () => {
    const { user } = open();
    await user.click(press('Raktų pora „Jonas“'));
    await user.click(press('Pašalinti raktų porą'));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Raktų pora „Jonas“' })).not.toBeInTheDocument());

    expect(said()).toContain('Transakcija dar nebaigta');
    expect(said()).toContain('Atrakinimo skriptas. Šios detalės raktų poros nebėra — ji pašalinta.');
    expect(said()).toContain('Užrakto skriptas (transakcijos A išvestis #0). Šios detalės raktų poros nebėra — ji pašalinta.');
    expect(screen.getByText('dar nebaigta')).toBeInTheDocument();
    expect(press('Rodyti žingsniais')).toBeDisabled();
    expect(stack()).toEqual(['tuščias']);
  });
});







// -----------------------------------------------------------
// Data
// -----------------------------------------------------------

describe('data', () => {

  const field = () => screen.getByRole('textbox', { name: 'Nauji duomenys' });

  it('offers what is typed as a piece at once, plain and hashed', async () => {
    const { user } = open();
    await user.type(field(), 'labas');

    expect(offered('„labas“')).toBeInTheDocument();
    expect(offered('SHA-256 maiša („labas“)')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Sukurti duomenys' })).not.toBeInTheDocument();
  });


  it.each([
    ['840000', '840000'],
    ['5', '5'],
    ['"5"', '„5“'],
    ['0xA1B2', '0xa1b2'],
    ['du žodžiai', '„du žodžiai“'],
  ])('reads "%s" by what it looks like, as %s', async (typed, piece) => {
    const { user } = open();
    await user.type(field(), typed);

    expect(offered(piece)).toBeInTheDocument();
  });


  it('says why what is typed is no data, and offers nothing', async () => {
    const { user } = open();
    await user.type(field(), '0xabc');

    expect(screen.getByRole('alert')).toHaveTextContent('„0xabc“ — ne baitai: po 0x turi eiti lyginis šešioliktainių skaitmenų skaičius.');
    expect(screen.queryByRole('combobox', { name: 'Maišos funkcija' })).not.toBeInTheDocument();
  });


  it('offers the hash by any of the five functions a script has an opcode for', async () => {
    const { user } = open();
    await user.type(field(), 'labas');

    expect(within(screen.getByRole('combobox', { name: 'Maišos funkcija' })).getAllByRole('option').map((option) => option.textContent)).toEqual(['SHA-256', 'HASH160', 'RIPEMD-160', 'HASH256', 'SHA-1']);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Maišos funkcija' }), 'HASH160');
    expect(offered('HASH160 maiša („labas“)')).toBeInTheDocument();
  });


  it('puts a piece that is taken into the script in use and onto the shelf, and offers it only there from then on', async () => {
    const { user } = open();
    await user.type(field(), 'labas');
    await user.click(offered('„labas“'));

    expect(wordsOf(UNLOCK)).toEqual([...P2PKH_UNLOCK, '„labas“']);
    expect(within(screen.getByRole('list', { name: 'Sukurti duomenys' })).getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Įdėti: „labas“' })).toHaveLength(1);
    expect(offered('SHA-256 maiša („labas“)')).toBeInTheDocument();
  });


  it('keeps a piece that was carried into a script on the shelf as well', () => {
    giveTilesAPlace();
    open();
    fireEvent.change(field(), { target: { value: '840000' } });
    carry(offered('840000'), rowOf(LOCK), 10);

    expect(wordsOf(LOCK)).toEqual(['840000', ...P2PKH_LOCK]);
    expect(within(screen.getByRole('list', { name: 'Sukurti duomenys' })).getByRole('button', { name: 'Įdėti: 840000' })).toBeInTheDocument();
  });


  it('builds a password lock from a hash made on the spot, and opens it with the password', async () => {
    const { user } = open();
    await user.click(sceneButton('Suma'));

    await user.click(press(`Išvalyti: ${LOCK}`));
    await user.click(offered('OP_SHA256'));
    await user.type(field(), 'labas');
    await user.click(offered('SHA-256 maiša („labas“)'));
    await user.click(offered('OP_EQUAL'));
    expect(wordsOf(LOCK)).toEqual(['OP_SHA256', 'SHA-256 maiša („labas“)', 'OP_EQUAL']);

    await user.click(press(`Išvalyti: ${UNLOCK}`));
    await user.click(offered('„labas“'));
    expect(said()).toContain('Transakcija B priimta');

    await user.click(tileOf(LOCK, 'OP_SHA256'));
    expect(stack()).toEqual(['SHA-256 „labas“']);
    expect(said()).toContain('Maišoma: „labas“. Gauta: SHA-256 maiša („labas“).');
  });


  it('throws a piece off the shelf without touching the script that uses it', async () => {
    const { user } = open();
    await user.type(field(), 'labas');
    await user.click(offered('„labas“'));
    await user.click(press('Išmesti: „labas“'));

    expect(screen.queryByRole('list', { name: 'Sukurti duomenys' })).not.toBeInTheDocument();
    expect(wordsOf(UNLOCK)).toEqual([...P2PKH_UNLOCK, '„labas“']);
  });


  it('shows the hash in the password scene by the password it was made from', async () => {
    const { user } = open();
    await user.click(sceneButton('Slaptažodis'));

    expect(wordsOf(LOCK)).toEqual(['OP_SHA256', 'SHA-256 maiša („satoshi“)', 'OP_EQUAL']);
    expect(wordsOf(UNLOCK)).toEqual(['„satoshi“']);
    expect(said()).toContain('Transakcija B priimta');
  });
});







// -----------------------------------------------------------
// The two transactions
// -----------------------------------------------------------

describe('the two transactions', () => {

  it('shows the lock of the coin that is picked, and lets the node say that coin holds too little', async () => {
    const { user } = open();
    await user.click(within(cardOf('A')).getByRole('radio', { name: 'Išvestis #1: 0.3 BTC, adresas „Gabija“ (P2PKH)' }));

    expect(wordsOf(LOCK)).toEqual(['OP_DUP', 'OP_HASH160', 'rakto maiša „Gabija“', 'OP_EQUALVERIFY', 'OP_CHECKSIG']);
    expect(within(cardOf('B')).getByText('trūksta 0.1999 BTC')).toBeInTheDocument();
    expect(said()).toContain('Mazgas sustojo ties klausimu „Ar išdalijama ne daugiau, nei yra?“');
    expect(said()).toContain('Išvestys išdalija daugiau, nei verta moneta. Pinigų iš nieko sukurti negalima.');
    expect(answers()).toEqual(['Moneta: taip', 'Sumos: ne', 'Laikas: neklausta', 'Skriptai: neklausta']);
    expect(stack()).toEqual(['tuščias']);
  });


  it('changes an amount where it stands: a press, the number, Enter', async () => {
    const { user } = open();
    await user.click(press('Transakcijos B išvesties #0 suma: 0.4999 BTC'));
    await retype(user, screen.getByRole('textbox', { name: 'Transakcijos B išvesties #0 suma' }), '0.4{Enter}');

    expect(press('Transakcijos B išvesties #0 suma: 0.4 BTC')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Transakcijos B išvesties #0 suma' })).not.toBeInTheDocument();
    expect(within(cardOf('B')).getByText('kasėjui 0.1 BTC')).toBeInTheDocument();
    expect(said()).toContain('Transakcija B priimta');
  });


  it('changes the amount of the picked coin of A the same way', async () => {
    const { user } = open();
    await user.click(press('Išvesties #0 suma: 0.5 BTC'));
    await retype(user, screen.getByRole('textbox', { name: 'Išvesties #0 suma' }), '0,75{Enter}');

    expect(within(cardOf('A')).getAllByRole('radio')[0]).toHaveAccessibleName('Išvestis #0: 0.75 BTC, adresas „Jonas“ (P2PKH)');
    expect(within(cardOf('B')).getByText('kasėjui 0.2501 BTC')).toBeInTheDocument();
    expect(said()).toContain('Transakcija B priimta');
  });


  it('has nothing to check while an amount cannot be read, and says which', async () => {
    const { user } = open();
    await user.click(press('Transakcijos B išvesties #0 suma: 0.4999 BTC'));
    await retype(user, screen.getByRole('textbox', { name: 'Transakcijos B išvesties #0 suma' }), 'daug{Enter}');

    expect(press('Transakcijos B išvesties #0 suma: daug BTC')).toBeInTheDocument();
    expect(said()).toContain('Transakcija dar nebaigta');
    expect(said()).toContain('Transakcijos B išvesties #0 suma. Suma turi būti skaičius, ne daugiau kaip 8 skaitmenys po kablelio.');
    expect(screen.getByText('dar nebaigta')).toBeInTheDocument();
    expect(press('Rodyti žingsniais')).toBeDisabled();
    expect(within(cardOf('B')).queryByText(/kasėjui|trūksta/)).not.toBeInTheDocument();
  });


  it('adds coins to transaction A up to four, and removes the picked one', async () => {
    const { user } = open();
    await user.click(press('Pridėti transakcijos A išvestį'));
    await user.click(press('Pridėti transakcijos A išvestį'));

    expect(within(cardOf('A')).getAllByRole('radio')).toHaveLength(LIMITS.OUTPUTS);
    expect(within(cardOf('A')).getAllByRole('radio')[2]).toHaveAccessibleName('Išvestis #2: 0.1 BTC, adresas „Jonas“ (P2PKH)');
    expect(screen.queryByRole('button', { name: 'Pridėti transakcijos A išvestį' })).not.toBeInTheDocument();

    await user.click(press('Pašalinti išvestį #0'));
    expect(within(cardOf('A')).getAllByRole('radio').map((coin) => [coin.getAttribute('aria-label'), coin.checked])).toEqual([
      ['Išvestis #0: 0.3 BTC, adresas „Gabija“ (P2PKH)', true],
      ['Išvestis #1: 0.1 BTC, adresas „Jonas“ (P2PKH)', false],
      ['Išvestis #2: 0.1 BTC, adresas „Jonas“ (P2PKH)', false],
    ]);
  });


  it('adds coins to transaction B up to three, and keeps the last one', async () => {
    const { user } = open();
    const outputs = () => within(within(cardOf('B')).getByRole('list', { name: 'Transakcijos B išvestys' })).getAllByRole('listitem');

    await user.click(press('Pridėti transakcijos B išvestį'));
    expect(outputs()).toHaveLength(2);
    expect(screen.getByRole('combobox', { name: 'Transakcijos B išvesties #1 gavėjas' })).toHaveDisplayValue('Jonas');
    expect(within(cardOf('B')).getByText('trūksta 0.0999 BTC')).toBeInTheDocument();

    await user.click(press('Pridėti transakcijos B išvestį'));
    expect(outputs()).toHaveLength(LIMITS.PAYMENTS);
    expect(screen.queryByRole('button', { name: 'Pridėti transakcijos B išvestį' })).not.toBeInTheDocument();

    await user.click(press('Pašalinti transakcijos B išvestį #2'));
    await user.click(press('Pašalinti transakcijos B išvestį #1'));
    expect(outputs()).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Pašalinti transakcijos B išvestį #0' })).not.toBeInTheDocument();
    expect(said()).toContain('Transakcija B priimta');
  });


  it('pays whoever is chosen, and signs the changed transaction anew', async () => {
    const { user } = open();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Transakcijos B išvesties #0 gavėjas' }), 'Jonas');

    expect(screen.getByRole('combobox', { name: 'Transakcijos B išvesties #0 gavėjas' })).toHaveDisplayValue('Jonas');
    expect(said()).toContain('Transakcija B priimta');
  });
});







// -----------------------------------------------------------
// Further settings
// -----------------------------------------------------------

describe('further settings', () => {

  const openDrawer = async (user) => user.click(press('Daugiau nustatymų'));

  it('opens on a press', async () => {
    const { user } = open();
    await openDrawer(user);

    expect(press('Daugiau nustatymų')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText('Transakcijos B nLockTime')).toHaveValue('0');
    expect(screen.getByLabelText('Grandinės aukštis')).toHaveValue('850000');
    expect(screen.getByLabelText('Įvesties nSequence')).toHaveValue('');
    expect(screen.getByLabelText('Įvesties nSequence')).toHaveAttribute('placeholder', '0xffffffff');
    expect(screen.getByLabelText('Įvesties nSequence')).toHaveAccessibleDescription('santykinio užrakto nėra, nLockTime negalioja');
    expect(screen.getByLabelText('Transakcijos A blokas')).toHaveValue('800000');
    expect(screen.getByLabelText('Transakcijos A blokas')).toHaveAccessibleDescription('moneta turi 50001 patvirtinimą');
    expect(screen.getByLabelText('Monetą jau išleido kita transakcija')).not.toBeChecked();
    expect(screen.getByLabelText('Užšaldyti parašus')).not.toBeChecked();
  });


  it('is open from the start in the scene that is about time', async () => {
    const { user } = open();
    await loadScene(user, 'Laiko užraktas');

    expect(screen.getByLabelText('Transakcijos B nLockTime')).toHaveValue('840000');
    expect(said()).toContain('Transakcija B priimta');
  });


  it('holds a transaction back while the chain has not reached its lock time', async () => {
    const { user } = open();
    await loadScene(user, 'Laiko užraktas');
    await retype(user, screen.getByLabelText('Grandinės aukštis'), '839999');

    expect(said()).toContain('Mazgas sustojo ties klausimu „Ar transakcijai jau laikas?“');
    expect(said()).toContain('Transakcijai dar ne laikas: grandinė dar nepasiekė bloko, kurį nurodo nLockTime.');
    expect(answers()).toEqual(['Moneta: taip', 'Sumos: taip', 'Laikas: ne', 'Skriptai: neklausta']);
  });


  it('lets the script itself refuse a transaction whose lock time is lower than the lock demands', async () => {
    const { user } = open();
    await loadScene(user, 'Laiko užraktas');
    await retype(user, screen.getByLabelText('Transakcijos B nLockTime'), '839999');

    expect(said()).toContain('Mazgas sustojo užrakto skripte, ties žodžiu OP_CHECKLOCKTIMEVERIFY.');
    expect(said()).toContain('Transakcijos nLockTime mažesnis, nei reikalauja skriptas — monetai dar ne laikas.');
  });


  it('says under the field when a number is none, and has nothing to check meanwhile', async () => {
    const { user } = open();
    await openDrawer(user);
    await retype(user, screen.getByLabelText('Grandinės aukštis'), 'aukštai');

    expect(screen.getByLabelText('Grandinės aukštis')).toHaveAccessibleDescription('Čia turi būti sveikasis skaičius.');
    expect(said()).toContain('Grandinės aukštis. Čia turi būti sveikasis skaičius.');
    expect(press('Rodyti žingsniais')).toBeDisabled();
  });


  it('turns a coin another transaction has spent down at the node\'s first question', async () => {
    const { user } = open();
    await openDrawer(user);
    await user.click(screen.getByLabelText('Monetą jau išleido kita transakcija'));

    expect(said()).toContain('Mazgas sustojo ties klausimu „Ar tokia moneta yra ir dar neišleista?“');
    expect(said()).toContain('Šios monetos mazgo rinkinyje nebėra: ją jau išleido kita transakcija. Tos pačios monetos dukart išleisti negalima.');
    expect(answers()).toEqual(['Moneta: ne', 'Sumos: neklausta', 'Laikas: neklausta', 'Skriptai: neklausta']);
    expect(stack()).toEqual(['tuščias']);
  });


  it('lets frozen signatures go stale when the transaction changes, and signs again when asked', async () => {
    const { user } = open();
    await openDrawer(user);
    await user.click(screen.getByLabelText('Užšaldyti parašus'));
    expect(screen.getByText('Parašai lieka tokie, kokie yra dabar. Pakeisk transakciją B — sumą, gavėją ar išleidžiamą monetą — ir jie nebetiks.')).toBeInTheDocument();
    expect(said()).toContain('Transakcija B priimta');

    await user.selectOptions(screen.getByRole('combobox', { name: 'Transakcijos B išvesties #0 gavėjas' }), 'Jonas');
    expect(wordsOf(UNLOCK)).toEqual(['parašas „Jonas“ (senas)', 'viešasis raktas „Jonas“']);
    expect(said()).toContain('Parašas netinka: arba pasirašyta kitu raktu, arba pasirašyta kita transakcija — ši pakeista po pasirašymo.');
    expect(screen.getByText('Transakcija B pakeista po pasirašymo: jos parašai pasirašė ankstesnę transakciją ir nebetinka.')).toBeInTheDocument();

    await user.click(press('Pasirašyti iš naujo'));
    expect(wordsOf(UNLOCK)).toEqual(P2PKH_UNLOCK);
    expect(said()).toContain('Transakcija B priimta');
    expect(screen.getByLabelText('Užšaldyti parašus')).toBeChecked();

    await user.click(screen.getByLabelText('Užšaldyti parašus'));
    expect(screen.queryByText(/^Parašai lieka tokie/)).not.toBeInTheDocument();
  });


  it('brings an empty redeem script on a press, and sends pressed pieces there', async () => {
    const { user } = open();
    await openDrawer(user);
    await user.click(press('Pridėti išpirkimo skriptą'));

    expect(within(rowOf(REDEEM)).getByText('Tempk detales čia')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pridėti išpirkimo skriptą' })).not.toBeInTheDocument();

    await user.click(offered('1'));
    expect(wordsOf(REDEEM)).toEqual(['1']);
    expect(wordsOf(UNLOCK)).toEqual(P2PKH_UNLOCK);
  });


  it('offers a redeem script to the other scripts as two pieces: itself and its hash', async () => {
    const { user } = open();
    await user.click(sceneButton('P2SH'));

    expect(wordsOf(REDEEM)).toEqual(['2', 'viešasis raktas „Jonas“', 'viešasis raktas „Gabija“', '2', 'OP_CHECKMULTISIG']);
    expect(wordsOf(LOCK)).toEqual(['OP_HASH160', 'išpirkimo skripto maiša', 'OP_EQUAL']);
    expect(wordsOf(UNLOCK)).toEqual(['0', 'parašas „Jonas“', 'parašas „Gabija“', 'išpirkimo skriptas']);
    expect(within(screen.getByRole('group', { name: 'Išpirkimo skriptas kaip detalės' })).getAllByRole('button').map((piece) => piece.getAttribute('aria-label'))).toEqual(['Įdėti: išpirkimo skriptas', 'Įdėti: išpirkimo skripto maiša']);

    await user.click(offered('išpirkimo skriptas'));
    expect(wordsOf(UNLOCK)).toHaveLength(5);
    expect(wordsOf(REDEEM)).toHaveLength(5);
  });
});







// -----------------------------------------------------------
// The scenes
// -----------------------------------------------------------

describe('the scenes', () => {

  it.each(EXAMPLES)('loads "$label" with its sentence and the node\'s verdict on it', async ({ id, label, about }) => {
    const { user } = open();
    await loadScene(user, label);

    expect(sceneButton(label)).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(about)).toBeInTheDocument();
    expect(said()).toContain(['theft', 'burned'].includes(id) ? 'Transakcija B atmesta' : 'Transakcija B priimta');
  });


  it('shows another group\'s scenes on a press of its name, and loads nothing by that', async () => {
    const { user } = open();
    await user.click(crossOf(UNLOCK, 'viešasis raktas „Jonas“'));
    await user.click(groupTab('Lightning'));

    expect(scenesShown()).toEqual(['to_local', 'Bauda', 'HTLC siūlomas', 'HTLC gautas']);
    expect(groupTab('Lightning')).toHaveAttribute('aria-pressed', 'true');
    expect(within(screen.getByRole('group', { name: 'Scenos' })).queryByRole('button', { pressed: true })).not.toBeInTheDocument();
    expect(wordsOf(UNLOCK)).toEqual(['parašas „Jonas“']);
    expect(screen.getByText(/^Įprasčiausias užraktas/)).toBeInTheDocument();

    await user.click(groupTab('Atominiai mainai'));
    expect(scenesShown()).toEqual(['Mainas LTC', 'Mainas BTC', 'Grąžinimas', 'Submarine']);

    await user.click(groupTab('Užraktai'));
    expect(sceneButton('P2PKH')).toHaveAttribute('aria-pressed', 'true');
  });


  it('goes back to showing the group of the scene in use whenever a scene is loaded', async () => {
    const { user } = open();
    await loadScene(user, 'Bauda');
    expect(groupTab('Lightning')).toHaveAttribute('aria-pressed', 'true');
    expect(sceneButton('Bauda')).toHaveAttribute('aria-pressed', 'true');

    await user.click(groupTab('Užraktai'));
    await user.click(press('Iš naujo'));
    expect(groupTab('Lightning')).toHaveAttribute('aria-pressed', 'true');
    expect(scenesShown()).toEqual(['to_local', 'Bauda', 'HTLC siūlomas', 'HTLC gautas']);
  });


  it('brings only the key pairs a scene uses', async () => {
    const { user } = open();
    const pairs = () => within(tray()).getAllByRole('button', { name: /^Raktų pora „/ }).map((button) => button.getAttribute('aria-label'));

    await user.click(sceneButton('Suma'));
    expect(pairs()).toEqual(['Raktų pora „Simona“']);

    await user.click(sceneButton('Multisig'));
    expect(pairs()).toEqual(['Raktų pora „Jonas“', 'Raktų pora „Gabija“', 'Raktų pora „Rokas“', 'Raktų pora „Simona“']);
  });


  it('starts every scene with the unlocking script in use and nothing to take back', async () => {
    const { user } = open();
    await user.click(rowOf(LOCK));
    await user.click(offered('OP_DUP'));
    await user.click(sceneButton('Suma'));
    await user.click(offered('1'));

    expect(wordsOf(UNLOCK)).toEqual(['2', '3', '1']);
    expect(wordsOf(LOCK)).toEqual(['OP_ADD', '5', 'OP_EQUAL']);

    await user.click(press('Atšaukti'));
    expect(press('Atšaukti')).toBeDisabled();
  });


  it('never spends the coin behind OP_RETURN, whatever is tried', async () => {
    const { user } = open();
    await user.click(sceneButton('OP_RETURN'));

    expect(said()).toContain('OP_RETURN visada žlugdo skriptą: ši moneta neišleidžiama niekuo.');
    expect(within(cardOf('A')).getAllByRole('radio')[0]).toHaveAccessibleName('Išvestis #0: 0.001 BTC, duomenys, neišleidžiama (OP_RETURN)');
  });


  it('shows the branch of a lock that was not taken as struck out', async () => {
    const { user } = open();
    await user.click(sceneButton('Du keliai'));

    const marks = within(rowOf(LOCK)).getAllByRole('button').filter((tile) => !tile.getAttribute('aria-label').startsWith('Išimti: ')).map((tile) => tile.querySelector('[data-step]').dataset.step);
    expect(marks).toEqual(['todo', 'todo', 'todo', 'todo', 'skipped', 'skipped', 'skipped', 'skipped', 'todo']);
  });
});







// -----------------------------------------------------------
// Lightning and the swaps
// -----------------------------------------------------------

describe('Lightning and the swaps', () => {

  it('opens the holder\'s own share of a channel with the wait its script asks for, and shows the numbers behind it', async () => {
    const { user } = open();
    await loadScene(user, 'to_local');

    expect(wordsOf(WITNESS_SCRIPT)).toEqual(['OP_IF', 'viešasis raktas „Atšaukimas“', 'OP_ELSE', '144', 'OP_CHECKSEQUENCEVERIFY', 'OP_DROP', 'viešasis raktas „Jonas“', 'OP_ENDIF', 'OP_CHECKSIG']);
    expect(wordsOf(LOCK)).toEqual(['0', 'witness script maiša']);
    expect(wordsOf(WITNESS)).toEqual(['parašas „Jonas“', '0', 'witness script']);
    expect(screen.queryByRole('list', { name: UNLOCK })).not.toBeInTheDocument();
    expect(said()).toContain('Transakcija B priimta');
    expect(screen.getByLabelText('Įvesties nSequence')).toHaveValue('144');
    expect(screen.getByLabelText('Įvesties nSequence')).toHaveAccessibleDescription('moneta turi būti 144 blokų senumo');
    expect(screen.getByLabelText('Transakcijos A blokas')).toHaveAccessibleDescription('moneta turi 201 patvirtinimą');
    expect(within(cardOf('A')).getAllByRole('radio').map((coin) => [coin.getAttribute('aria-label'), coin.checked])).toEqual([
      ['Išvestis #0: 0.02 BTC, SegWit adresas „Gabija“ (P2WPKH)', false],
      ['Išvestis #1: 0.03 BTC, witness script maiša (P2WSH)', true],
    ]);
  });


  it('says what the sequence opcode held the input to when its word is pressed', async () => {
    const { user } = open();
    await loadScene(user, 'to_local');
    await user.click(tileOf(WITNESS_SCRIPT, 'OP_CHECKSEQUENCEVERIFY'));

    expect(said()).toContain('Skriptas reikalauja, kad įvesties nSequence būtų bent 144; transakcijos B įvesties nSequence — 144. Tinka.');
    expect(stack()).toEqual(['sig Jonas', '144']);
  });


  it('holds the holder back at the node\'s question about time while the coin is too young', async () => {
    const { user } = open();
    await loadScene(user, 'to_local');
    await retype(user, screen.getByLabelText('Transakcijos A blokas'), '849990');

    expect(screen.getByLabelText('Transakcijos A blokas')).toHaveAccessibleDescription('moneta turi 11 patvirtinimų');
    expect(said()).toContain('Mazgas sustojo ties klausimu „Ar transakcijai jau laikas?“');
    expect(said()).toContain('Monetai dar ne laikas: įvesties nSequence reikalauja, kad ji būtų bent 144 blokų senumo, o ji turi tik 11 patvirtinimų.');
    expect(answers()).toEqual(['Moneta: taip', 'Sumos: taip', 'Laikas: ne', 'Skriptai: neklausta']);
  });


  it('lets the script refuse an input that promises too short a wait, or none', async () => {
    const { user } = open();
    await loadScene(user, 'to_local');
    await retype(user, screen.getByLabelText('Įvesties nSequence'), '100');

    expect(said()).toContain('Mazgas sustojo witness script viduje, ties žodžiu OP_CHECKSEQUENCEVERIFY.');
    expect(said()).toContain('Įvesties nSequence mažesnis, nei reikalauja skriptas — transakcija B nepažadėjo laukti tiek, kiek reikia.');

    await user.clear(screen.getByLabelText('Įvesties nSequence'));
    expect(said()).toContain('Įvestis santykinį užraktą išjungusi (nSequence aukščiausias bitas nustatytas), todėl reikalavimas netenkinamas.');
  });


  it('says under the field when a sequence number is none', async () => {
    const { user } = open();
    await loadScene(user, 'to_local');
    await retype(user, screen.getByLabelText('Įvesties nSequence'), 'ilgai');

    expect(screen.getByLabelText('Įvesties nSequence')).toHaveAccessibleDescription('nSequence turi būti sveikasis skaičius nuo 0 iki 4294967295 — dešimtainis arba šešioliktainis po 0x.');
    expect(said()).toContain('Įvesties nSequence. nSequence turi būti sveikasis skaičius');
  });


  it('lets the other side take the same output at once with the revocation key', async () => {
    const { user } = open();
    await loadScene(user, 'Bauda');

    expect(wordsOf(WITNESS)).toEqual(['parašas „Atšaukimas“', '1', 'witness script']);
    expect(said()).toContain('Transakcija B priimta');
    expect(within(tray()).getAllByRole('button', { name: /^Raktų pora „/ }).map((button) => button.getAttribute('aria-label'))).toEqual(['Raktų pora „Jonas“', 'Raktų pora „Gabija“', 'Raktų pora „Atšaukimas“']);
  });


  it('names a payment\'s thirty-two byte secret by its two ends, and its hash by that secret', async () => {
    const { user } = open();
    await loadScene(user, 'HTLC siūlomas');

    expect(wordsOf(WITNESS)).toEqual(['parašas „Gabija“', '„lightning mo…žodis“ (32 B)', 'witness script']);
    expect(wordsOf(WITNESS_SCRIPT)).toContain('HASH160 maiša („lightning mo…žodis“)');
    expect(wordsOf(WITNESS_SCRIPT)).toHaveLength(26);
    expect(within(cardOf('A')).getAllByRole('radio').map((coin) => coin.getAttribute('aria-label'))).toEqual([
      'Išvestis #0: 0.001 BTC, witness script maiša (P2WSH)',
      'Išvestis #1: 0.02 BTC, SegWit adresas „Gabija“ (P2WPKH)',
      'Išvestis #2: 0.029 BTC, witness script maiša (P2WSH)',
    ]);
    expect(said()).toContain('Transakcija B priimta');
  });


  it('opens a payment that has timed out for the side that sent it', async () => {
    const { user } = open();
    await loadScene(user, 'HTLC gautas');

    expect(wordsOf(WITNESS)).toEqual(['parašas „Gabija“', '0', 'witness script']);
    expect(screen.getByLabelText('Transakcijos B nLockTime')).toHaveValue('850040');
    expect(said()).toContain('Transakcija B priimta');
  });


  it('shows the Litecoin side of a swap in LTC, with Litecoin\'s coin', async () => {
    const { user } = open();
    await loadScene(user, 'Mainas LTC');

    expect(within(cardOf('A')).getAllByRole('radio')[0]).toHaveAccessibleName('Išvestis #0: 1 LTC, skripto maiša (P2SH)');
    expect(press('Transakcijos B išvesties #0 suma: 0.9999 LTC')).toBeInTheDocument();
    expect(within(cardOf('B')).getByText('kasėjui 0.0001 LTC')).toBeInTheDocument();
    expect([...cardOf('A').querySelectorAll('[data-chain]'), ...cardOf('B').querySelectorAll('[data-chain]')].map((coin) => coin.dataset.chain)).toEqual(['ltc', 'ltc', 'ltc']);
    expect(said()).toContain('Transakcija B priimta');
  });


  it('opens the Bitcoin side of the swap with the very secret the Litecoin side showed', async () => {
    const { user } = open();
    await loadScene(user, 'Mainas LTC');
    const shown = wordsOf(UNLOCK)[2];
    const hashed = wordsOf(REDEEM)[5];

    await user.click(sceneButton('Mainas BTC'));
    expect(wordsOf(UNLOCK)).toEqual(['parašas „Gabija“', 'viešasis raktas „Gabija“', shown, '1', 'išpirkimo skriptas']);
    expect(wordsOf(REDEEM)[5]).toBe(hashed);
    expect(hashed).toBe('SHA-256 maiša („Jono ir Gabi…aptis“)');
    expect(press('Transakcijos B išvesties #0 suma: 0.0009 BTC')).toBeInTheDocument();
    expect([...cardOf('A').querySelectorAll('[data-chain]')].map((coin) => coin.dataset.chain)).toEqual(['btc']);
    expect(said()).toContain('Transakcija B priimta');
  });


  it('keeps a swap\'s coin from going back before the time limit', async () => {
    const { user } = open();
    await loadScene(user, 'Grąžinimas');
    expect(said()).toContain('Transakcija B priimta');

    await retype(user, screen.getByLabelText('Grandinės aukštis'), '850200');
    expect(said()).toContain('Transakcijai dar ne laikas: grandinė dar nepasiekė bloko, kurį nurodo nLockTime.');
  });


  it('opens a submarine swap with the secret of the Lightning payment', async () => {
    const { user } = open();
    await loadScene(user, 'Submarine');

    expect(wordsOf(UNLOCK)).toEqual(['parašas „Simona“', '„lightning mo…žodis“ (32 B)', 'išpirkimo skriptas']);
    expect(wordsOf(REDEEM)).toEqual(['OP_HASH160', 'HASH160 maiša („lightning mo…žodis“)', 'OP_EQUAL', 'OP_IF', 'viešasis raktas „Simona“', 'OP_ELSE', '850144', 'OP_CHECKLOCKTIMEVERIFY', 'OP_DROP', 'viešasis raktas „Jonas“', 'OP_ENDIF', 'OP_CHECKSIG']);
    expect(said()).toContain('Transakcija B priimta');
  });
});







// -----------------------------------------------------------
// SegWit and Taproot
// -----------------------------------------------------------

describe('SegWit and Taproot', () => {

  const headings = () => within(screen.getByRole('region', { name: 'Skriptai' })).getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent);
  const piecesOf = (row) => within(screen.getByRole('group', { name: `${row} kaip detalės` })).getAllByRole('button').map((piece) => piece.getAttribute('aria-label'));
  const keyPieces = () => within(tray()).getAllByRole('button', { name: /^Įdėti: .*„Jonas“$/ }).map((piece) => piece.getAttribute('aria-label'));

  it('shows a coin paid to a witness key hash as a witness, a lock, and the script the node builds itself — with no unlocking script', async () => {
    const { user } = open();
    await loadScene(user, 'P2WPKH');

    expect(headings()).toEqual([WITNESS, LOCK, IMPLIED]);
    expect(wordsOf(WITNESS)).toEqual(P2PKH_UNLOCK);
    expect(wordsOf(LOCK)).toEqual(['0', 'rakto maiša „Jonas“']);
    expect(wordsOf(IMPLIED)).toEqual(P2PKH_LOCK);
    expect(screen.getByText('transakcijos B įvestis, šalia skripto')).toBeInTheDocument();
    expect(screen.getByText('P2PKH skriptas, kurį mazgas sudaro pats iš rakto maišos')).toBeInTheDocument();
    expect(within(cardOf('A')).getAllByRole('radio')[0]).toHaveAccessibleName('Išvestis #0: 0.5 BTC, SegWit adresas „Jonas“ (P2WPKH)');
    expect(said()).toContain('Transakcija B priimta');
  });


  it('sends pressed pieces to the witness where there is no unlocking script, and lets its tiles be taken out', async () => {
    const { user } = open();
    await loadScene(user, 'P2WPKH');
    await user.click(offered('1'));
    expect(wordsOf(WITNESS)).toEqual([...P2PKH_UNLOCK, '1']);
    expect(said()).toContain('P2WPKH monetai atrakinti witness turi turėti lygiai du elementus — parašą ir viešąjį raktą, o jų yra 3.');

    await user.click(crossOf(WITNESS, '1'));
    expect(said()).toContain('Transakcija B priimta');
  });


  it('lays the witness out as the stack when one of its tiles is pressed, and walks the script the node built', async () => {
    const { user } = open();
    await loadScene(user, 'P2WPKH');

    await user.click(tileOf(WITNESS, 'parašas „Jonas“'));
    expect(said()).toContain('Witness program: rakto maiša (P2WPKH)');
    expect(stack()).toEqual(['sig Jonas', 'pubKey Jonas']);

    await user.click(tileOf(IMPLIED, 'OP_HASH160'));
    expect(said()).toContain('scriptCode: OP_HASH160');
    expect(tileOf(IMPLIED, 'OP_HASH160')).toHaveAttribute('aria-current', 'step');
    expect(stack()).toEqual(['sig Jonas', 'pubKey Jonas', 'pubKeyHash Jonas']);
  });


  it('lets nobody change the script the node builds itself', async () => {
    const { user } = open();
    await loadScene(user, 'P2WPKH');

    expect(within(rowOf(IMPLIED)).queryByRole('button', { name: /^Išimti: / })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: `Išvalyti: ${IMPLIED}` })).not.toBeInTheDocument();
    expect(tileOf(IMPLIED, 'OP_DUP')).not.toHaveAttribute('draggable');
  });


  it('says a witness holds data only when an opcode is put into it', async () => {
    const { user } = open();
    await loadScene(user, 'P2WPKH');
    await user.click(offered('OP_DUP'));

    expect(said()).toContain('Transakcija dar nebaigta');
    expect(said()).toContain('Witness. „OP_DUP“ čia netinka: witness nevykdomas, jame gali būti tik duomenys.');
  });


  it('brings the unlocking script back on a press, and turns down a witness program spent with anything in it', async () => {
    const { user } = open();
    await loadScene(user, 'P2WPKH');
    await user.click(press('Daugiau nustatymų'));
    await user.click(press('Pridėti atrakinimo skriptą'));

    expect(headings()).toEqual([UNLOCK, WITNESS, LOCK, IMPLIED]);
    expect(screen.queryByRole('button', { name: 'Pridėti atrakinimo skriptą' })).not.toBeInTheDocument();

    await user.click(offered('1'));
    expect(wordsOf(UNLOCK)).toEqual(['1']);
    expect(said()).toContain('Monetai, užrakintai witness program, atrakinimo skriptas turi likti tuščias: viskas, kas ją atrakina, dedama į witness.');
  });


  it('shows a coin paid to a witness script hash with its script under the line, on offer as itself and as its hash', async () => {
    const { user } = open();
    await loadScene(user, 'P2WSH');

    expect(headings()).toEqual([WITNESS, LOCK, WITNESS_SCRIPT]);
    expect(wordsOf(WITNESS)).toEqual(['0', 'parašas „Jonas“', 'parašas „Rokas“', 'witness script']);
    expect(wordsOf(LOCK)).toEqual(['0', 'witness script maiša']);
    expect(wordsOf(WITNESS_SCRIPT)).toEqual(['2', 'viešasis raktas „Jonas“', 'viešasis raktas „Gabija“', 'viešasis raktas „Rokas“', '3', 'OP_CHECKMULTISIG']);
    expect(piecesOf(WITNESS_SCRIPT)).toEqual(['Įdėti: witness script', 'Įdėti: witness script maiša']);
    expect(screen.getByText('jo maiša užrakinta P2WSH moneta')).toBeInTheDocument();
  });


  it('follows the node from the witness into the witness script', async () => {
    const { user } = open();
    await loadScene(user, 'P2WSH');

    await user.click(tileOf(WITNESS, 'witness script'));
    expect(said()).toContain('Witness program: skripto maiša (P2WSH)');
    expect(said()).toContain('Paskutinis witness elementas yra pats skriptas (witness script), ir jo maiša sutapo.');
    expect(stack()).toEqual(['0 (FALSE)', 'sig Jonas', 'sig Rokas']);

    await user.click(press('Žingsnis pirmyn'));
    expect(said()).toContain('Witness script: 2');
    expect(tileOf(WITNESS_SCRIPT, '2')).toHaveAttribute('aria-current', 'step');
  });


  it('stacks the unlocking script and the witness of a wrapped program, and opens its layers one by one', async () => {
    const { user } = open();
    await loadScene(user, 'P2SH-P2WPKH');

    expect(headings()).toEqual([UNLOCK, WITNESS, LOCK, REDEEM, IMPLIED]);
    expect(wordsOf(UNLOCK)).toEqual(['išpirkimo skriptas']);
    expect(wordsOf(REDEEM)).toEqual(['0', 'rakto maiša „Jonas“']);
    expect(said()).toContain('Transakcija B priimta');

    await loadScene(user, 'P2SH-P2WSH');
    expect(headings()).toEqual([UNLOCK, WITNESS, LOCK, REDEEM, WITNESS_SCRIPT]);
    expect(wordsOf(REDEEM)).toEqual(['0', 'witness script maiša']);
    expect(said()).toContain('Transakcija B priimta');
  });


  it('shows a Taproot coin opened by its key as one signature and one key, and nothing else', async () => {
    const { user } = open();
    await loadScene(user, 'P2TR raktu');

    expect(headings()).toEqual([WITNESS, LOCK]);
    expect(wordsOf(WITNESS)).toEqual(['parašas „Jonas“']);
    expect(wordsOf(LOCK)).toEqual(['1', 'output key „Jonas“']);
    expect(within(cardOf('A')).getAllByRole('radio')[0]).toHaveAccessibleName('Išvestis #0: 0.5 BTC, Taproot output key „Jonas“ (P2TR)');

    await user.click(tileOf(WITNESS, 'parašas „Jonas“'));
    expect(said()).toContain('Taproot: atrakinama raktu');
    expect(said()).toContain('Witness turi vieną elementą, vadinasi, tai parašas pačiam raktui, ir joks skriptas nevykdomas.');
  });


  it('offers a key pair\'s Taproot pieces in a Taproot scene, and the everyday ones elsewhere', async () => {
    const { user } = open();
    expect(keyPieces()).toEqual(['Įdėti: parašas „Jonas“', 'Įdėti: viešasis raktas „Jonas“', 'Įdėti: rakto maiša „Jonas“']);

    await loadScene(user, 'P2TR raktu');
    expect(keyPieces()).toEqual(['Įdėti: parašas „Jonas“', 'Įdėti: x-only raktas „Jonas“', 'Įdėti: output key „Jonas“']);

    await user.click(press(`Išvalyti: ${LOCK}`));
    expect(keyPieces()).toEqual(['Įdėti: parašas „Jonas“', 'Įdėti: x-only raktas „Jonas“', 'Įdėti: output key „Jonas“']);
  });


  it('rebuilds the Taproot lock from the tray, and refuses the wrong owner\'s signature at the witness', async () => {
    const { user } = open();
    await loadScene(user, 'P2TR raktu');
    await user.click(press(`Išvalyti: ${LOCK}`));
    await user.click(rowOf(LOCK));
    await user.click(offered('1'));
    await user.click(offered('output key „Gabija“'));

    expect(wordsOf(LOCK)).toEqual(['1', 'output key „Gabija“']);
    expect(said()).toContain('Mazgas sustojo tikrindamas witness.');
    expect(said()).toContain('Schnorr parašas netinka: pasirašyta kitu raktu arba kita transakcija.');
  });


  it('shows the two scripts a Taproot key hides under the line, each on offer as itself and as its proof', async () => {
    const { user } = open();
    await loadScene(user, 'P2TR skriptu');

    expect(headings()).toEqual([WITNESS, LOCK, LEAF_A, LEAF_B]);
    expect(wordsOf(WITNESS)).toEqual(['parašas „Rokas“', '„taproot“', 'tapscript B', 'control block B']);
    expect(wordsOf(LEAF_A)).toEqual(['x-only raktas „Gabija“', 'OP_CHECKSIG']);
    expect(wordsOf(LEAF_B)).toEqual(['OP_SHA256', 'SHA-256 maiša („taproot“)', 'OP_EQUALVERIFY', 'x-only raktas „Rokas“', 'OP_CHECKSIG']);
    expect(piecesOf(LEAF_A)).toEqual(['Įdėti: tapscript A', 'Įdėti: control block A']);
    expect(piecesOf(LEAF_B)).toEqual(['Įdėti: tapscript B', 'Įdėti: control block B']);
    expect(screen.getAllByText('paslėptas output key viduje')).toHaveLength(2);
  });


  it('walks only the script the witness shows, and names it', async () => {
    const { user } = open();
    await loadScene(user, 'P2TR skriptu');

    await user.click(tileOf(WITNESS, 'tapscript B'));
    expect(said()).toContain('Taproot: atrakinama skriptu');
    expect(said()).toContain('Kitų medžio skriptų niekas nepamato — control block turi tik jų maišą.');
    expect(stack()).toEqual(['sig Rokas', '„taproot“']);

    await user.click(tileOf(LEAF_B, 'OP_EQUALVERIFY'));
    expect(said()).toContain('Tapscript B: OP_EQUALVERIFY');

    await user.click(tileOf(LEAF_A, 'OP_CHECKSIG'));
    expect(said()).toContain('Tapscript B: OP_EQUALVERIFY');
  });


  it('opens the same coin without any script, as the scene\'s sentence suggests', async () => {
    const { user } = open();
    await loadScene(user, 'P2TR skriptu');
    await user.click(press(`Išvalyti: ${WITNESS}`));
    expect(said()).toContain('Witness tuščias, o šiai monetai atrakinti jo reikia.');

    await user.click(offered('parašas „Jonas“'));
    expect(wordsOf(WITNESS)).toEqual(['parašas „Jonas“']);
    expect(said()).toContain('Transakcija B priimta');
  });


  it('opens it by the other hidden script too: that script, its proof, and its owner\'s signature', async () => {
    const { user } = open();
    await loadScene(user, 'P2TR skriptu');
    await user.click(press(`Išvalyti: ${WITNESS}`));
    await user.click(offered('parašas „Gabija“'));
    await user.click(offered('tapscript A'));
    await user.click(offered('control block B'));
    expect(said()).toContain('Control block neveda prie užrakto output key: šis skriptas jame nepaslėptas, arba control block — ne šio skripto.');

    await user.click(crossOf(WITNESS, 'control block B'));
    await user.click(offered('control block A'));
    expect(said()).toContain('Transakcija B priimta');
  });


  it('counts signatures the Taproot way, and says how far the count has got', async () => {
    const { user } = open();
    await loadScene(user, 'CHECKSIGADD');

    expect(wordsOf(WITNESS)).toEqual(['parašas „Rokas“', '0', 'parašas „Jonas“', 'tapscript A', 'control block A']);
    expect(within(rowOf(LEAF_B)).getByText('Tempk detales čia')).toBeInTheDocument();

    await user.click(within(rowOf(LEAF_A)).getAllByRole('button', { name: 'OP_CHECKSIGADD' })[0]);
    expect(said()).toContain('Parašo vietoje — tuščia reikšmė; ji nieko nepasirašo.');
    expect(said()).toContain('Tinkamų parašų iki šiol: 1.');
  });


  it('lets anybody spend the anchor with an empty witness', async () => {
    const { user } = open();
    await loadScene(user, 'Anchor (P2A)');

    expect(headings()).toEqual([WITNESS, LOCK]);
    expect(within(rowOf(WITNESS)).getByText('Tempk detales čia')).toBeInTheDocument();
    expect(wordsOf(LOCK)).toEqual(['1', '0x4e73']);
    expect(within(cardOf('A')).getAllByRole('radio')[0]).toHaveAccessibleName('Išvestis #0: 0.0000024 BTC, anchor, išleidžia bet kas (P2A)');
    expect(said()).toContain('Transakcija B priimta');

    await user.click(press('Žingsnis atgal'));
    expect(said()).toContain('Witness program: anchor (P2A)');
  });


  it('brings the witness, a witness script and the Taproot scripts on a press each, and the Taproot pieces with the last', async () => {
    const { user } = open();
    await user.click(press('Daugiau nustatymų'));
    await user.click(press('Pridėti witness'));
    await user.click(press('Pridėti witness script'));
    await user.click(press('Pridėti tapscript A ir B'));

    expect(headings()).toEqual([UNLOCK, WITNESS, LOCK, WITNESS_SCRIPT, LEAF_A, LEAF_B]);
    expect(screen.queryByRole('button', { name: /^Pridėti (witness|witness script|tapscript A ir B)$/ })).not.toBeInTheDocument();
    expect(press('Pridėti išpirkimo skriptą')).toBeInTheDocument();
    expect(keyPieces()).toEqual(['Įdėti: parašas „Jonas“', 'Įdėti: x-only raktas „Jonas“', 'Įdėti: output key „Jonas“']);

    await user.click(offered('x-only raktas „Jonas“'));
    expect(wordsOf(LEAF_A)).toEqual(['x-only raktas „Jonas“']);
    expect(wordsOf(UNLOCK)).toEqual(P2PKH_UNLOCK);
  });


  it('turns down a witness the lock never asked for', async () => {
    const { user } = open();
    await user.click(press('Daugiau nustatymų'));
    await user.click(press('Pridėti witness'));
    await user.click(offered('1'));

    expect(wordsOf(WITNESS)).toEqual(['1']);
    expect(said()).toContain('Transakcija atnešė witness, kurio šis užraktas neprašo — tokia transakcija negalioja.');
  });
});







// -----------------------------------------------------------
// Inside the real app
// -----------------------------------------------------------

describe('inside the real app', () => {

  it('lives at /bitcoin-script and titles its tab', async () => {
    renderApp({ route: '/bitcoin-script' });

    expect(await screen.findByRole('heading', { level: 1, name: 'Bitcoin skriptų žaidimų aikštelė' })).toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe("Bitcoin skriptų žaidimų aikštelė — VU KNF Faucet'as"));
  });


  it('is reached from the "Kiti įrankiai" menu', async () => {
    const { user } = renderApp({ route: '/presentations' });
    await user.click(await screen.findByRole('button', { name: 'Kiti įrankiai' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Bitcoin skriptų žaidimų aikštelė' }));

    expect(window.location.pathname).toBe('/bitcoin-script');
    expect(await screen.findByRole('list', { name: 'Stekas, nuo apačios į viršų' })).toBeInTheDocument();
  });


  it('works with the backend down, and keeps nothing in the browser', async () => {
    given.networkError('get', '/api/faucet/catalog');
    const { user } = renderApp({ route: '/bitcoin-script' });

    expect(await screen.findByRole('heading', { level: 1, name: 'Bitcoin skriptų žaidimų aikštelė' })).toBeInTheDocument();
    await user.click(offered('OP_DUP'));
    await user.click(press('Atšaukti'));

    expect(stack()).toEqual(['1 (TRUE)']);
    expect(said()).toContain('Transakcija B priimta');
    expect(Object.keys(localStorage)).toEqual([]);
  });
});
