// -----------------------------------------------------------
//  [*] Tests — Blockchain Simulator page (route /sha256)
//
//  The proof-of-work teaching toy end to end: the opening
//  two-block chain (unmined, red), every shown hash being the
//  SHA-256 of "previous hash \n nonce \n transactions" — what
//  the external SHA256 tool computes from the copied text —
//  re-hashed on every keystroke, a typed nonce hashing like a
//  mined one, an edit rippling down the chain (the edited
//  block and every later one turn "✗ Sugadintas", in the card
//  title and the minimap), the difficulty selector re-colouring
//  without re-hashing, mining (the first nonce with the
//  required zeros; the pickaxe counting the tries in
//  Lithuanian, stopping, the other pickaxes locked, a result
//  dropped when the block was edited meanwhile, a search
//  abandoned with the page — the animation frames and the
//  clock stepped by hand), re-mining repairing the chain,
//  adding blocks, the copy button (clipboard, the
//  "Nukopijuota!" toast at the cursor, no toast when the copy
//  failed), the SHA256 tool link (a plain new-tab link,
//  window.open never used), the example chain from
//  /api/get-example-blockchain (loading, failures and garbage
//  answers leave the student's chain alone, a retry, and the
//  chain re-linked and re-hashed on arrival, so a block edited
//  in the database shows as broken with every block after it)
//  with its backend contract matrix, the minimap's scroll sync,
//  and the real App's route and title.
//
//  Math.random picks the cast of a generated block, so the
//  tests fix it: the opening block #1 is always "Jonas (50BTC)
//  / Satoshi ---> Saulius (2BTC)". The expected hashes were
//  computed once with crypto-js — the same function the SHA256
//  tool implements — and are spelled out; the sha() helper is
//  that tool for the values a test cannot know in advance.
// -----------------------------------------------------------

import { describe, it, expect, vi } from 'vitest';
import { screen, within, waitFor, fireEvent, act } from '@testing-library/react';
import sha256 from 'crypto-js/sha256';
import { renderPage, renderApp } from '../support/render';
import { given } from '../support/backend/server';
import { describeEndpointContract, settle, expectNoCrash } from '../support/backend/contract';
import * as f from '../support/backend/fixtures';
import BlockchainSimulator from '@/pages/BlockchainSimulator/Page';


// The opening chain (see the header) and its hashes
const GENESIS_DATA = '1) Nauja kriptovaliuta ---> Satoshi (50BTC)';
const BLOCK1_DATA = '1) Nauja kriptovaliuta ---> Jonas (50BTC)\n2) Satoshi ---> Saulius (2BTC)';
const GENESIS_HASH = '1a29030dd00735862b6b072dc301c8693000d7d103d980541ba2afd34970109d';
const BLOCK1_HASH = 'c55a4fcc3d1ee242f84a805a98237511b7e06eec2c7037a4113ca0922f7bbd56';

// What mining finds for them: the first nonce whose hash has
// the required zeros
const MINED = {
  genesisAt1: { nonce: '57', hash: '08dfa2eee86846e9cbbe4d1a366a7280e58959949903e73286f99c887bddd6bb' },
  genesisAt2: { nonce: '568', hash: '00fd47d94671fa62be44a440e837d4557743d51a6f1ca09c0a48b9d9352ee93b' },
  genesisAt4: { nonce: '6812', hash: '00000aae3c456e693a6181b5156e96ea8736e862313c0cb75ca8a9aa033744b0' },
  block1At2: { nonce: '137', hash: '000c1d46d71cf06f7e8973529d99910cdfc0ef19cb1fd1713f834c0e45bdf7d0' },
};

const LOAD_EXAMPLE = 'Užkrauti pavyzdinę blokų grandinę';
const LOAD_FAILED = 'Nepavyko užkrauti pavyzdinės blokų grandinės. Bandykite dar kartą.';
const VALID = '✓ Galiojantis';
const BROKEN = '✗ Sugadintas';

// The external SHA256 tool, for hashes a test cannot know in
// advance (the nonce a re-mine finds for edited data)
const sha = (previousHash, nonce, data) => sha256(`${previousHash}\n${nonce}\n${data}`).toString();







// -----------------------------------------------------------
// Helpers
// -----------------------------------------------------------
//
// renderSimulator fixes the cast (Math.random) and mounts the
// page. A block is reached through its heading ("Blokas #n
// … ✓ Galiojantis"): the card is the heading's parent, its
// fields and hashes are read by their Lithuanian labels.
// mineOn runs the real search at a low difficulty; the
// stepping tests drive the animation frames themselves.
// -----------------------------------------------------------

function renderSimulator() {
  vi.spyOn(Math, 'random').mockReturnValueOnce(0.25).mockReturnValueOnce(0.75);
  return renderPage(<BlockchainSimulator />);
}

// Asking for hidden elements too skips the per-element
// visibility check — nothing on this page is hidden, and with
// ten blocks that check is the slowest part of every query
const blockHeadings = () => screen.queryAllByRole('heading', { level: 6, hidden: true }).filter((heading) => /^Blokas #\d+\b/.test(heading.textContent));
const blockHeading = (index) => {
  const found = blockHeadings().find((heading) => new RegExp(`^Blokas #${index}\\b`).test(heading.textContent));
  if (!found) throw new Error(`no card for block #${index}`);
  return found;
};
const blockCount = () => blockHeadings().length;
const card = (index) => blockHeading(index).parentElement;
const state = (index) => (blockHeading(index).textContent.endsWith(VALID) ? VALID : BROKEN);

const nonceField = (index) => within(card(index)).getByRole('textbox', { name: 'Numeris (Nonce):' });
const dataField = (index) => within(card(index)).getByRole('textbox', { name: 'Transakcijos:' });

const labelled = (index, label) => within(card(index)).getByText(label).parentElement.textContent.slice(label.length).trim();
const thisHash = (index) => labelled(index, 'Šio bloko maišos kodas (SHA256):');
const previousHash = (index) => labelled(index, 'Ankstesnio bloko maišos kodas (SHA256):');

const pickaxe = (index) => within(card(index)).getByRole('button', { name: `Kasti bloką #${index}` });
const copyButton = (index) => within(card(index)).getByRole('button', { name: /^Kopijuoti bloko\s*tekstą$/ });
const minimapSquare = (index) => screen.getByTitle(new RegExp(`^Blokas #${index}: `));

async function setDifficulty(user, zeros) {
  await user.click(screen.getByRole('combobox', { name: 'Sudėtingumas (pradiniai nuliukai)' }));
  await user.click(await screen.findByRole('option', { name: String(zeros) }));
  await waitFor(() => expect(screen.getByRole('combobox', { name: 'Sudėtingumas (pradiniai nuliukai)' })).toHaveTextContent(String(zeros)));
}

async function mineOn(user, index) {
  await user.click(pickaxe(index));
  await waitFor(() => expect(state(index)).toBe(VALID));
}

async function loadExample(user) {
  await user.click(screen.getByRole('button', { name: LOAD_EXAMPLE }));
  await screen.findByRole('heading', { level: 6, name: /^Blokas #9\b/ });
}

// Mining by hand: rAF is faked (a frame runs when the test
// says so) and performance.now advances one "ms" per call, so
// every 16 ms slice tries exactly 15 nonces — or 1023 with a
// 1/64 step
function stepMiningByHand({ msPerCall = 1 } = {}) {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
  let now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => {
    now += msPerCall;
    return now;
  });
}

const nextFrame = () => act(() => { vi.advanceTimersToNextFrame(); });

// The running search's button — "Stabdyti", the tries and
// their noun in whichever form the count asks for
const stopButton = () => screen.getByRole('button', { name: /^Stabdyti · / });
const triesShown = () => Number(stopButton().textContent.match(/^Stabdyti · ([\d\s]+) bandym(?:as|ai|ų)$/)[1].replace(/\s/g, ''));







// -----------------------------------------------------------
// The opening chain
// -----------------------------------------------------------
//
// What the page shows before the student touches anything.
// -----------------------------------------------------------

describe('The opening chain', () => {

  it('opens with the title, difficulty 4, the tools and two unmined blocks, both broken', () => {
    renderSimulator();
    expect(screen.getByRole('heading', { level: 1, name: 'Blokų grandinės simuliatorius' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Sudėtingumas (pradiniai nuliukai)' })).toHaveTextContent('4');
    expect(screen.getByRole('button', { name: LOAD_EXAMPLE })).toBeEnabled();
    expect(screen.getByRole('link', { name: 'Internetinis SHA256 įrankis' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Pridėti naują bloką/ })).toBeEnabled();
    expect(blockCount()).toBe(2);
    expect([state(0), state(1)]).toEqual([BROKEN, BROKEN]);
    expect(screen.queryByText(LOAD_FAILED)).toBeNull();
  });


  it('block #0 is the genesis: previous hash 0, nonce 0, Satoshi\'s coinbase', () => {
    renderSimulator();
    expect(previousHash(0)).toBe('0');
    expect(nonceField(0)).toHaveValue('0');
    expect(dataField(0)).toHaveValue(GENESIS_DATA);
    expect(thisHash(0)).toBe(GENESIS_HASH);
  });


  it('block #1 is chained onto #0\'s hash: a coinbase to a random student and Satoshi\'s 2BTC payment', () => {
    renderSimulator();
    expect(previousHash(1)).toBe(GENESIS_HASH);
    expect(nonceField(1)).toHaveValue('0');
    expect(dataField(1)).toHaveValue(BLOCK1_DATA);
    expect(thisHash(1)).toBe(BLOCK1_HASH);
  });


  it('titles each card with the hash\'s first and last twelve characters and its state in words', () => {
    renderSimulator();
    expect(blockHeading(0)).toHaveTextContent(/^Blokas #0\s+-\s+\(1a29030dd007\.\.\.\.afd34970109d\)✗ Sugadintas$/);
    expect(blockHeading(1)).toHaveTextContent(/^Blokas #1\s+-\s+\(c55a4fcc3d1e\.\.\.\.a0922f7bbd56\)✗ Sugadintas$/);
  });


  it('every hash shown is the SHA-256 of "previous hash \\n nonce \\n transactions" — what the SHA256 tool computes', () => {
    renderSimulator();
    expect(thisHash(0)).toBe(sha('0', '0', GENESIS_DATA));
    expect(thisHash(1)).toBe(sha(thisHash(0), '0', BLOCK1_DATA));
  });


  it('the minimap shows one square per block, marked and titled by its state', () => {
    renderSimulator();
    // A line break parts "Blokų grandinės" from "žemėlapis" —
    // two lines, one heading
    expect(screen.getByRole('heading', { level: 6, name: /^Blokų grandinės\s*žemėlapis$/ })).toBeInTheDocument();
    expect(minimapSquare(0)).toHaveAttribute('title', 'Blokas #0: sugadintas');
    expect(minimapSquare(0)).toHaveTextContent('✗0');
    expect(minimapSquare(1)).toHaveAttribute('title', 'Blokas #1: sugadintas');
    expect(minimapSquare(1)).toHaveTextContent('✗1');
  });


  it('offers the SHA256 tool as a plain new-tab link — no window.open, no opener for the tool\'s page', async () => {
    const open = vi.fn();
    vi.stubGlobal('open', open);
    const { user } = renderSimulator();
    const tool = screen.getByRole('link', { name: 'Internetinis SHA256 įrankis' });
    expect(tool).toHaveAttribute('href', 'https://emn178.github.io/online-tools/sha256.html');
    expect(tool).toHaveAttribute('target', '_blank');
    expect(tool).toHaveAttribute('rel', 'noopener noreferrer');
    // jsdom cannot open a tab: the click's navigation is
    // stopped, what matters is that no script opened anything
    tool.addEventListener('click', (event) => event.preventDefault());
    await user.click(tool);
    expect(open).not.toHaveBeenCalled();
  });


  it('the /sha256 route of the real App shows the simulator and titles the tab', async () => {
    renderApp({ route: '/sha256' });
    expect(await screen.findByRole('heading', { level: 1, name: 'Blokų grandinės simuliatorius' })).toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe("Blokų grandinės simuliatorius — VU KNF Faucet'as"));
  });
});







// -----------------------------------------------------------
// Hashing as the student types
// -----------------------------------------------------------
//
// Every keystroke in a nonce or in the transactions re-hashes
// that block and every block after it.
// -----------------------------------------------------------

describe('Hashing as the student types', () => {

  it('re-hashes the block on every keystroke in its transactions', async () => {
    const { user } = renderSimulator();
    await user.type(dataField(0), 'a');
    expect(thisHash(0)).toBe('ef7fb19b3f0ed0e2529ff188835bf06d349bb6722c15bcd92ad827108e9e3e84');
    await user.type(dataField(0), 'b');
    expect(dataField(0)).toHaveValue(`${GENESIS_DATA}ab`);
    expect(thisHash(0)).toBe('36f78039a8664e69526fdee082d99956de9220fed9749939aa5e8fd9dbbe5a6c');
  });


  it('a typed nonce hashes exactly like a mined one — 568 makes the genesis valid at difficulty 2', async () => {
    const { user } = renderSimulator();
    await setDifficulty(user, 2);
    await user.clear(nonceField(0));
    await user.type(nonceField(0), '568');
    expect(thisHash(0)).toBe(MINED.genesisAt2.hash);
    expect(state(0)).toBe(VALID);
    expect(pickaxe(0)).toBeDisabled();
  });


  it('the nonce is hashed as typed — "0568" is another preimage than 568', async () => {
    const { user } = renderSimulator();
    await setDifficulty(user, 2);
    await user.clear(nonceField(0));
    await user.type(nonceField(0), '0568');
    expect(thisHash(0)).toBe('8009ee4197d1b80c8cb17cced52a91c7eb4faa7955e09be669c309440bbfdf0a');
    expect(state(0)).toBe(BROKEN);
  });


  it('an edit ripples down: the next block is re-linked to the new hash and re-hashed with its old nonce', async () => {
    const { user } = renderSimulator();
    await user.type(dataField(0), 'X');
    const newGenesis = sha('0', '0', `${GENESIS_DATA}X`);
    expect(thisHash(0)).toBe(newGenesis);
    expect(previousHash(1)).toBe(newGenesis);
    expect(nonceField(1)).toHaveValue('0');
    expect(thisHash(1)).toBe(sha(newGenesis, '0', BLOCK1_DATA));
  });


  it('an edit further down leaves the blocks before it alone', async () => {
    const { user } = renderSimulator();
    await user.type(dataField(1), '!');
    expect(thisHash(0)).toBe(GENESIS_HASH);
    expect(thisHash(1)).toBe(sha(GENESIS_HASH, '0', `${BLOCK1_DATA}!`));
  });
});







// -----------------------------------------------------------
// Difficulty
// -----------------------------------------------------------
//
// How many leading zeros a valid hash needs: 1 … 5, applied
// to every block at once, never re-hashing anything.
// -----------------------------------------------------------

describe('Difficulty', () => {

  it('offers one to five leading zeros', async () => {
    const { user } = renderSimulator();
    await user.click(screen.getByRole('combobox', { name: 'Sudėtingumas (pradiniai nuliukai)' }));
    expect((await screen.findAllByRole('option')).map((option) => option.textContent)).toEqual(['1', '2', '3', '4', '5']);
  });


  it('re-colours every block at once without re-hashing: one zero is valid at 1, broken at 2', async () => {
    const { user } = renderSimulator();
    await setDifficulty(user, 1);
    await mineOn(user, 0);
    expect(thisHash(0)).toBe(MINED.genesisAt1.hash);

    await setDifficulty(user, 2);
    expect(state(0)).toBe(BROKEN);
    expect(minimapSquare(0)).toHaveAttribute('title', 'Blokas #0: sugadintas');
    expect(thisHash(0)).toBe(MINED.genesisAt1.hash);
    expect(pickaxe(0)).toBeEnabled();

    await setDifficulty(user, 1);
    expect(state(0)).toBe(VALID);
    expect(thisHash(0)).toBe(MINED.genesisAt1.hash);
  });


  it('a re-linked block can be valid by luck at a low difficulty — "00fec6e1…" needs no mining at 1', async () => {
    const { user } = renderSimulator();
    await setDifficulty(user, 1);
    await mineOn(user, 0);
    // Mining #0 re-hashed #1 (nonce still 0) into a hash that
    // happens to start with zeros
    expect(thisHash(1)).toBe('00fec6e1f7fb01b3d7650c26430ba678692ebfd5e5b6ec56efe993ac3a487bd5');
    expect(state(1)).toBe(VALID);
    expect(pickaxe(1)).toBeDisabled();
  });
});







// -----------------------------------------------------------
// Mining
// -----------------------------------------------------------
//
// The pickaxe searches nonces from 0 up for the first hash
// with the required zeros; while it runs it counts the tries,
// offers a stop and locks the other pickaxes.
// -----------------------------------------------------------

describe('Mining', () => {

  it('mines the genesis at the default difficulty: the first nonce with four leading zeros', async () => {
    const { user } = renderSimulator();
    await user.click(pickaxe(0));
    // ~6 800 real SHA-256 hashes in 16 ms slices, one per frame —
    // quick alone, seconds when the whole suite shares the CPUs
    await waitFor(() => expect(state(0)).toBe(VALID), { timeout: 15000 });
    expect(nonceField(0)).toHaveValue(MINED.genesisAt4.nonce);
    expect(thisHash(0)).toBe(MINED.genesisAt4.hash);
    expect(thisHash(0)).toMatch(/^0000/);
    expect(pickaxe(0)).toBeDisabled();
    expect(minimapSquare(0)).toHaveAttribute('title', 'Blokas #0: galiojantis');
    expect(minimapSquare(0)).toHaveTextContent('✓0');
  });


  it('mining a block re-links the next one, which stays broken until it is mined too', async () => {
    const { user } = renderSimulator();
    await setDifficulty(user, 2);
    await mineOn(user, 0);
    expect(nonceField(0)).toHaveValue(MINED.genesisAt2.nonce);
    expect(previousHash(1)).toBe(MINED.genesisAt2.hash);
    expect(thisHash(1)).toBe('316698e0f6538dbdd4055fcb5ec0b4dc07902ceaf1c2c070ca238feb2cc8c8cb');
    expect(state(1)).toBe(BROKEN);

    await mineOn(user, 1);
    expect(nonceField(1)).toHaveValue(MINED.block1At2.nonce);
    expect(thisHash(1)).toBe(MINED.block1At2.hash);
    expect([state(0), state(1)]).toEqual([VALID, VALID]);
  });


  it('while a block is mined its pickaxe counts the tries and every other pickaxe is locked', async () => {
    stepMiningByHand();
    const { user } = renderSimulator();
    await setDifficulty(user, 5);
    await user.click(pickaxe(0));
    expect(stopButton()).toHaveTextContent('Stabdyti · 0 bandymų');
    expect(pickaxe(1)).toBeDisabled();

    await nextFrame();
    expect(triesShown()).toBe(15);
    await nextFrame();
    expect(triesShown()).toBe(30);
    expect(state(0)).toBe(BROKEN);
    expect(nonceField(0)).toHaveValue('0');
  });


  it('counts the tries the Lithuanian way — "1 023 bandymai", grouped with a no-break space', async () => {
    stepMiningByHand({ msPerCall: 1 / 64 });
    const { user } = renderSimulator();
    await setDifficulty(user, 5);
    await user.click(pickaxe(0));
    await nextFrame();
    // The raw text: toHaveTextContent would fold the no-break
    // space into a plain one
    expect(stopButton().textContent).toBe('Stabdyti · 1\u00a0023 bandymai');
  });


  it('declines the tries with their count — "1 bandymas", then "2 bandymai"', async () => {
    // Ten "ms" per clock reading: every 16 ms slice tries one
    // nonce
    stepMiningByHand({ msPerCall: 10 });
    const { user } = renderSimulator();
    await setDifficulty(user, 5);
    await user.click(pickaxe(0));
    await nextFrame();
    expect(stopButton().textContent).toBe('Stabdyti · 1 bandymas');
    await nextFrame();
    expect(stopButton().textContent).toBe('Stabdyti · 2 bandymai');
  });


  it('Stabdyti ends the search: the pickaxe comes back, the block keeps its nonce and stays broken', async () => {
    stepMiningByHand();
    const { user } = renderSimulator();
    await setDifficulty(user, 5);
    await user.click(pickaxe(0));
    await nextFrame();
    await user.click(stopButton());
    await nextFrame();

    expect(screen.queryByRole('button', { name: /^Stabdyti/ })).toBeNull();
    expect(pickaxe(0)).toBeEnabled();
    expect(pickaxe(1)).toBeEnabled();
    expect(nonceField(0)).toHaveValue('0');
    expect(state(0)).toBe(BROKEN);
    // Nothing keeps running in the background
    expect(vi.getTimerCount()).toBe(0);
  });


  it('a search whose block is edited meanwhile is dropped — the edit stands, nothing is committed against it', async () => {
    stepMiningByHand();
    const { user } = renderSimulator();
    await setDifficulty(user, 1);
    await user.click(pickaxe(0));
    await nextFrame();
    expect(triesShown()).toBe(15);

    // The answer for the OLD text is nonce 57 — three frames on.
    // One keystroke's change event (user-event's async wrapper
    // would still be settling when the frames are stepped)
    fireEvent.change(dataField(0), { target: { value: `${GENESIS_DATA}x` } });
    for (let frame = 0; frame < 3; frame += 1) await nextFrame();

    expect(screen.queryByRole('button', { name: /^Stabdyti/ })).toBeNull();
    expect(dataField(0)).toHaveValue(`${GENESIS_DATA}x`);
    expect(nonceField(0)).toHaveValue('0');
    expect(thisHash(0)).toBe('75459896702e0097a7399ba73c27e738e3cff06e59c1932df334064bc880d7fb');
    expect(state(0)).toBe(BROKEN);
  });


  it('leaving the page abandons a running search — no frame is asked for after it', async () => {
    stepMiningByHand();
    const { user, unmount } = renderSimulator();
    await setDifficulty(user, 5);
    await user.click(pickaxe(0));
    await nextFrame();
    unmount();
    await nextFrame();
    expect(vi.getTimerCount()).toBe(0);
  });
});







// -----------------------------------------------------------
// Breaking and repairing the chain
// -----------------------------------------------------------
//
// On the pre-mined example chain: a change breaks its block
// and every block after it; undoing it or re-mining in order
// repairs the chain.
// -----------------------------------------------------------

describe('Breaking and repairing the chain', () => {

  it('changing block #3\'s transactions breaks #3 and every block after it — #0 … #2 stay valid', async () => {
    const { user } = renderSimulator();
    await loadExample(user);
    await user.type(dataField(3), 'x');
    expect([0, 1, 2].map(state)).toEqual([VALID, VALID, VALID]);
    expect([3, 4, 5, 6, 7, 8, 9].map(state)).toEqual(Array(7).fill(BROKEN));
    expect([0, 1, 2, 3, 9].map((index) => minimapSquare(index).textContent)).toEqual(['✓0', '✓1', '✓2', '✗3', '✗9']);
    expect(previousHash(4)).toBe(thisHash(3));
  });


  it('changing a nonce breaks just the same — #5 on breaks #5 … #9', async () => {
    const { user } = renderSimulator();
    await loadExample(user);
    await user.type(nonceField(5), '1');
    expect(nonceField(5)).toHaveValue('5062817929671');
    expect([0, 1, 2, 3, 4].map(state)).toEqual(Array(5).fill(VALID));
    expect([5, 6, 7, 8, 9].map(state)).toEqual(Array(5).fill(BROKEN));
  });


  it('undoing the change restores every hash — the chain is valid again without mining', async () => {
    const { user } = renderSimulator();
    await loadExample(user);
    await user.type(dataField(3), 'x');
    expect(state(9)).toBe(BROKEN);
    await user.type(dataField(3), '{Backspace}');
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(state)).toEqual(Array(10).fill(VALID));
    expect(thisHash(9)).toBe(f.exampleBlockchain[9].hash);
  });


  it('re-mining the broken blocks in order repairs the chain', async () => {
    const { user } = renderSimulator();
    await setDifficulty(user, 2);
    await mineOn(user, 0);
    await mineOn(user, 1);
    await user.type(dataField(0), 'x');
    expect([state(0), state(1)]).toEqual([BROKEN, BROKEN]);

    await mineOn(user, 0);
    expect(thisHash(0)).toBe('00fd07edcad9aefbccde917026f17bf56e3a65a5db9ce00991d284c8b100b2f9');
    expect(state(1)).toBe(BROKEN);
    await mineOn(user, 1);
    expect(thisHash(1)).toBe('00d09e69844cb9eeef6a3efca55a656b1068effd81b9c4fb44d99b3f57ed7a45');
    expect(thisHash(1)).toBe(sha(thisHash(0), nonceField(1).value, BLOCK1_DATA));
    expect([state(0), state(1)]).toEqual([VALID, VALID]);
  });
});







// -----------------------------------------------------------
// Adding blocks
// -----------------------------------------------------------
//
// "Pridėti naują bloką" appends an unmined block onto the
// current tail.
// -----------------------------------------------------------

describe('Adding blocks', () => {

  it('appends an unmined block chained onto the last hash, with a coinbase and a random payment', async () => {
    const { user } = renderSimulator();
    vi.spyOn(Math, 'random').mockReturnValueOnce(0.5).mockReturnValueOnce(0.45).mockReturnValueOnce(0.875).mockReturnValueOnce(0.125);
    await user.click(screen.getByRole('button', { name: /^Pridėti naują bloką/ }));

    expect(blockCount()).toBe(3);
    expect(previousHash(2)).toBe(BLOCK1_HASH);
    expect(nonceField(2)).toHaveValue('0');
    expect(dataField(2)).toHaveValue('1) Nauja kriptovaliuta ---> Rokas (50BTC)\n2) Simona ---> Agnė (5BTC)');
    expect(thisHash(2)).toBe('9bdd42853cb39c49009a4f38a627fd0c4c9f963449d2d218ddcadb7a24a29cd8');
    expect(state(2)).toBe(BROKEN);
    expect(minimapSquare(2)).toHaveTextContent('✗2');
  });


  it('adds onto the example chain as block #10', async () => {
    const { user } = renderSimulator();
    await loadExample(user);
    await user.click(screen.getByRole('button', { name: /^Pridėti naują bloką/ }));
    expect(blockCount()).toBe(11);
    expect(previousHash(10)).toBe(f.exampleBlockchain[9].hash);
    expect(state(10)).toBe(BROKEN);
    expect(state(9)).toBe(VALID);
  });


  it('every generated payment is 1 to 10 BTC between two of the cast', async () => {
    const { user } = renderSimulator();
    for (let i = 0; i < 5; i += 1) await user.click(screen.getByRole('button', { name: /^Pridėti naują bloką/ }));
    for (let index = 2; index < 7; index += 1) {
      expect(dataField(index).value).toMatch(/^1\) Nauja kriptovaliuta ---> (Mantas|Agnė|Jonas|Gabija|Rokas|Eglė|Saulius|Simona) \(50BTC\)\n2\) (Mantas|Agnė|Jonas|Gabija|Rokas|Eglė|Saulius|Simona) ---> (Mantas|Agnė|Jonas|Gabija|Rokas|Eglė|Saulius|Simona) \(([1-9]|10)BTC\)$/);
    }
  });
});







// -----------------------------------------------------------
// Copying a block's text
// -----------------------------------------------------------
//
// "Kopijuoti bloko tekstą" copies the exact hash preimage and
// flashes "Nukopijuota!" at the cursor — only when the copy
// happened.
// -----------------------------------------------------------

describe('Copying a block\'s text', () => {

  it('copies "previous hash \\n nonce \\n transactions" — the SHA256 tool turns it into the shown hash', async () => {
    const { user } = renderSimulator();
    await user.click(copyButton(0));
    const copied = await navigator.clipboard.readText();
    expect(copied).toBe(`0\n0\n${GENESIS_DATA}`);
    expect(sha256(copied).toString()).toBe(thisHash(0));
  });


  it('a loaded example block copies to text that hashes to its stored hash', async () => {
    const { user } = renderSimulator();
    await loadExample(user);
    await user.click(copyButton(4));
    const copied = await navigator.clipboard.readText();
    expect(copied).toBe(`${f.exampleBlockchain[3].hash}\n${f.exampleBlockchain[4].nonce}\n${f.exampleBlockchain[4].data}`);
    expect(sha256(copied).toString()).toBe(f.exampleBlockchain[4].hash);
  });


  it('flashes "Nukopijuota!" ten pixels above the cursor for two seconds', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'clearTimeout'] });
    renderSimulator();
    fireEvent.click(copyButton(1), { clientX: 200, clientY: 300 });
    const toast = await screen.findByText('Nukopijuota!');
    expect(toast.style.left).toBe('200px');
    expect(toast.style.top).toBe('290px');
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(screen.queryByText('Nukopijuota!')).toBeNull();
  });


  it('without a clipboard API (a plain-http host) nothing claims success — no toast, a console warning', async () => {
    renderSimulator();
    vi.spyOn(navigator, 'clipboard', 'get').mockReturnValue(undefined);
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});
    fireEvent.click(copyButton(0), { clientX: 10, clientY: 10 });
    await settle(50);
    expect(screen.queryByText('Nukopijuota!')).toBeNull();
    expect(warned).toHaveBeenCalledWith('Copy failed:', expect.any(TypeError));
  });


  it('a refused clipboard permission shows no toast either', async () => {
    renderSimulator();
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new DOMException('Write permission denied.', 'NotAllowedError'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    fireEvent.click(copyButton(0), { clientX: 10, clientY: 10 });
    await settle(50);
    expect(screen.queryByText('Nukopijuota!')).toBeNull();
  });
});







// -----------------------------------------------------------
// The example chain
// -----------------------------------------------------------
//
// "Užkrauti pavyzdinę blokų grandinę" replaces the whole chain
// with the backend's pre-mined one — only a well-formed,
// non-empty answer replaces anything, and what replaces it is
// verified block by block, never taken as stored.
// -----------------------------------------------------------

describe('The example chain', () => {

  it('replaces the whole chain with the backend\'s ten pre-mined blocks, all valid', async () => {
    const calls = given.capture('get', '/api/get-example-blockchain', f.exampleBlockchain);
    const { user } = renderSimulator();
    await user.type(dataField(0), 'mano pakeitimas');
    await loadExample(user);

    expect(calls).toHaveLength(1);
    expect(blockCount()).toBe(10);
    f.exampleBlockchain.forEach((block, index) => {
      expect(previousHash(index)).toBe(block.previousHash);
      expect(nonceField(index)).toHaveValue(block.nonce);
      expect(dataField(index)).toHaveValue(block.data);
      expect(thisHash(index)).toBe(block.hash);
      expect(state(index)).toBe(VALID);
    });
  });


  it('the example is valid at every difficulty — its hashes have ten zeros', async () => {
    const { user } = renderSimulator();
    await loadExample(user);
    await setDifficulty(user, 5);
    expect(Array.from({ length: 10 }, (_, index) => state(index))).toEqual(Array(10).fill(VALID));
  });


  it('says "Kraunama…" on a disabled button while the chain is on its way', async () => {
    given.hang('get', '/api/get-example-blockchain');
    const { user } = renderSimulator();
    await user.click(screen.getByRole('button', { name: LOAD_EXAMPLE }));
    expect(await screen.findByRole('button', { name: 'Kraunama…' })).toBeDisabled();
    expect(blockCount()).toBe(2);
  });


  it.each([
    ['a 500 { error } answer', () => given.error('get', '/api/get-example-blockchain', 'Vidinė serverio klaida', 500)],
    ['the proxy\'s HTML 502 page', () => given.html('get', '/api/get-example-blockchain')],
    ['a dropped connection', () => given.networkError('get', '/api/get-example-blockchain')],
  ])('%s keeps the student\'s chain and says the load failed', async (_, answer) => {
    answer();
    const { user } = renderSimulator();
    await user.type(dataField(0), '!');
    const edited = thisHash(0);
    await user.click(screen.getByRole('button', { name: LOAD_EXAMPLE }));

    expect(await screen.findByText(LOAD_FAILED)).toBeInTheDocument();
    expect(blockCount()).toBe(2);
    expect(dataField(0)).toHaveValue(`${GENESIS_DATA}!`);
    expect(thisHash(0)).toBe(edited);
    expect(screen.getByRole('button', { name: LOAD_EXAMPLE })).toBeEnabled();
  });


  it.each([
    ['an empty list (the table emptied in dbgate)', []],
    ['blocks without hashes', [{ height: '0', data: 'x', previousHash: '0', nonce: '1' }]],
    ['a block whose previous hash is a number', [{ ...f.exampleBlockchain[0], previousHash: 0 }]],
    ['one bad block among good ones', [...f.exampleBlockchain.slice(0, 3), { ...f.exampleBlockchain[3], data: null }]],
    ['an object instead of a list', { blocks: f.exampleBlockchain }],
    ['a string', 'unexpected'],
    ['JSON null', null],
  ])('refuses %s the same way — nothing replaced, the failure said', async (_, body) => {
    given.json('get', '/api/get-example-blockchain', body);
    const { user } = renderSimulator();
    await user.click(screen.getByRole('button', { name: LOAD_EXAMPLE }));
    expect(await screen.findByText(LOAD_FAILED)).toBeInTheDocument();
    expect(blockCount()).toBe(2);
    expect(thisHash(0)).toBe(GENESIS_HASH);
  });


  it('a retry after a failure loads the chain and clears the message', async () => {
    given.sequence('get', '/api/get-example-blockchain', [
      { status: 500, body: { error: 'Vidinė serverio klaida' } },
      { body: f.exampleBlockchain },
    ]);
    const { user } = renderSimulator();
    await user.click(screen.getByRole('button', { name: LOAD_EXAMPLE }));
    await screen.findByText(LOAD_FAILED);
    await loadExample(user);
    expect(screen.queryByText(LOAD_FAILED)).toBeNull();
    expect(blockCount()).toBe(10);
  });


  it('takes a chain longer than the example whole — twenty blocks, numbered in order, the repeated half re-linked and broken', async () => {
    given.json('get', '/api/get-example-blockchain', [...f.exampleBlockchain, ...f.exampleBlockchain]);
    const { user } = renderSimulator();
    await user.click(screen.getByRole('button', { name: LOAD_EXAMPLE }));
    await waitFor(() => expect(blockCount()).toBe(20));
    expect(minimapSquare(9)).toHaveTextContent('✓9');
    // The second genesis does not chain onto block #9: linked to
    // its hash, it fails its proof of work, and so does every
    // block after it
    expect(previousHash(10)).toBe(f.exampleBlockchain[9].hash);
    expect(Array.from({ length: 10 }, (_, i) => state(10 + i))).toEqual(Array(10).fill(BROKEN));
    expect(minimapSquare(19)).toHaveTextContent('✗19');
    expect(thisHash(19)).toBe(sha(thisHash(18), f.exampleBlockchain[9].nonce, f.exampleBlockchain[9].data));
  });


  it('takes the blocks as they come — the numbering is their order, not their "height"', async () => {
    given.json('get', '/api/get-example-blockchain', f.exampleBlockchain.slice(0, 3).map((block) => ({ ...block, height: '42' })));
    const { user } = renderSimulator();
    await user.click(screen.getByRole('button', { name: LOAD_EXAMPLE }));
    await screen.findByRole('heading', { level: 6, name: /^Blokas #2\b/ });
    expect(blockCount()).toBe(3);
  });


  it('re-verifies the loaded chain — a block whose stored hash no longer matches its text shows as broken, and so does every block after it', async () => {
    const tampered = structuredClone(f.exampleBlockchain);
    tampered[3].data = tampered[3].data.replace('8BTC', '80BTC');
    given.json('get', '/api/get-example-blockchain', tampered);
    const { user } = renderSimulator();
    await loadExample(user);
    expect(thisHash(3)).toBe(sha(tampered[2].hash, tampered[3].nonce, tampered[3].data));
    expect(state(3)).toBe(BROKEN);
    expect(state(9)).toBe(BROKEN);
    expect([0, 1, 2].map(state)).toEqual([VALID, VALID, VALID]);
    expect([4, 5, 6, 7, 8].map(state)).toEqual(Array(5).fill(BROKEN));
    expect(previousHash(4)).toBe(thisHash(3));
  });
});







// -----------------------------------------------------------
// The minimap's scroll
// -----------------------------------------------------------
//
// The page's scroll ratio is mapped onto the minimap's own
// scrollbar; the listener leaves with the page.
// -----------------------------------------------------------

describe('The minimap\'s scroll', () => {

  // jsdom lays nothing out: the page and the minimap get the
  // heights their CSS would give them, and the minimap's
  // scrollTop records what the page sets
  function layOut(minimap) {
    vi.spyOn(document.documentElement, 'scrollHeight', 'get').mockReturnValue(3000);
    vi.stubGlobal('innerHeight', 1000);
    Object.defineProperty(minimap, 'scrollHeight', { configurable: true, value: 900 });
    Object.defineProperty(minimap, 'clientHeight', { configurable: true, value: 500 });
    const set = [];
    Object.defineProperty(minimap, 'scrollTop', { configurable: true, get: () => set.at(-1) ?? 0, set: (value) => { set.push(value); } });
    return set;
  }


  it('scrolls the minimap by the same share as the page — halfway down the page, halfway down the minimap', () => {
    renderSimulator();
    const minimap = minimapSquare(0).parentElement.parentElement;
    const scrolled = layOut(minimap);
    vi.stubGlobal('scrollY', 1000);
    fireEvent.scroll(window);
    // Halfway through the page's 2000 px of scroll is halfway
    // through the minimap's 400
    expect(scrolled.at(-1)).toBe(200);
  });


  it('stops listening once the page is left', () => {
    const added = vi.spyOn(window, 'addEventListener');
    const removed = vi.spyOn(window, 'removeEventListener');
    const { unmount } = renderSimulator();
    const onScroll = added.mock.calls.find(([type]) => type === 'scroll')[1];
    unmount();
    expect(removed).toHaveBeenCalledWith('scroll', onScroll);
  });
});







// -----------------------------------------------------------
// Backend contract
// -----------------------------------------------------------
//
// Every response variant against the one endpoint the page
// reads — fetched when the student asks for the example. A
// failure is the message under the tool buttons with the
// student's chain untouched; garbage is refused the same way.
// -----------------------------------------------------------

describeEndpointContract({
  path: '/api/get-example-blockchain',
  fixture: f.exampleBlockchain,
  render: () => {
    renderSimulator();
    fireEvent.click(screen.getByRole('button', { name: LOAD_EXAMPLE }));
  },
  chrome: () => screen.getByRole('heading', { level: 1, name: 'Blokų grandinės simuliatorius' }),
  loaded: async () => {
    await screen.findByRole('heading', { level: 6, name: /^Blokas #9\b/ });
    expect(thisHash(9)).toBe(f.exampleBlockchain[9].hash);
  },
  failed: async () => {
    await screen.findByText(LOAD_FAILED);
    expect(blockCount()).toBe(2);
    expectNoCrash();
  },
  loading: () => screen.getByRole('button', { name: 'Kraunama…' }),
  skip: {
    'a huge list (300 entries) → page survives': 'three hundred editable MUI block cards take jsdom ~45 s to render (a browser about a second) — a chain longer than the example is covered above with twenty blocks',
  },
});
