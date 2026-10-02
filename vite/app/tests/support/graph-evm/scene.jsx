// -----------------------------------------------------------
//  [*] Test support — the EVM graph's scene (clock, zone,
//      cast, render, readers)
//
//  What every EVM graph test file shares:
//
//    - a pinned clock and zone: the page's "today" is the
//      student's LOCAL date and every day travels to the
//      backend as a local-midnight window, so each test runs at
//      a known instant (2026-09-30 12:00) in a known IANA zone
//      (UTC unless the test moves the student elsewhere) —
//      process.env.TZ, which Node applies at once and which
//      endGraphSlate puts back
//    - fake timers that still follow real time
//      (shouldAdvanceTime): TanStack Query, msw and MUI keep
//      working, while advance jumps the sweeps' and the
//      midnight timer's clock on demand
//    - the cast of addresses and the day's transfers the
//      backend model (backend.js) answers from
//    - renderGraph and the readers of what a student sees:
//      the canvas (an image named with the day and the
//      transfer count), the visually hidden table of transfers,
//      the date bar
//
//  Used by:
//    - tests/pages/graph-evm/*.test.jsx
// -----------------------------------------------------------

import { vi, expect } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { renderPage } from '../render';
import * as f from '../backend/fixtures';
import { liveNetwork, resetNetworks } from './vis-network';
import GraphPage from '@/pages/Graph/Page';


// The viewed day of every test unless it says otherwise, and
// its neighbours in the fixture's day list
export const TODAY = '2026-09-30';

// Day windows as the backend receives them: [local 00:00,
// next local 00:00) in unix seconds — here for UTC
export const WINDOW = {
  '2026-09-25': { from: 1790294400, to: 1790380800 },
  '2026-09-28': { from: 1790553600, to: 1790640000 },
  '2026-09-29': { from: 1790640000, to: 1790726400 },
  '2026-09-30': { from: 1790726400, to: 1790812800 },
  '2026-10-01': { from: 1790812800, to: 1790899200 },
};

// The cast — lowercase, as the backend stores addresses. The
// faucet and Jonas are the shared fixtures' addresses; LINK is
// Chainlink's token contract on Sepolia, HUB a public
// community faucet the backend marks as a hub
export const ADDR = {
  FAUCET: f.FAUCET_EVM,
  JONAS: f.STUDENT_EVM,
  EGLE: '0x4e5f2a9c1b3d7e8f60a1b2c3d4e5f60718293a4b',
  PETRAS: '0x9a8b7c6d5e4f30211203f4e5d6c7b8a990817263',
  RUTA: '0x1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d',
  LINK: '0x779877a7b0d9e8603169ddbd7836e478b4624789',
  HUB: '0x5a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d',
};

// How the graph shortens an address: its first six
// characters and its last four, with three dots between
export const short = (address) => `${address.slice(0, 6)}...${address.slice(-4)}`;

// Unix seconds of a UTC wall-clock time on the pinned day
// (minutes past 59 roll over into the next hour)
export const at = (hh, mm = 0, day = TODAY) => Date.parse(`${day}T00:00:00Z`) / 1000 + hh * 3600 + mm * 60;

// The names the backend holds (Graph_Addresses rows)
export const NAMES = {
  [ADDR.FAUCET]: { name: 'KNF Faucet', contract: false, hub: false },
  [ADDR.JONAS]: { name: 'Jonas', contract: false, hub: false },
  [ADDR.EGLE]: { name: 'Eglė', contract: false, hub: false },
};

// Today's traffic around the faucet: two payouts, one return
export const DAY_TRANSFERS = [
  { from: ADDR.FAUCET, to: ADDR.JONAS, value: 0.2, at: at(10, 0) },
  { from: ADDR.FAUCET, to: ADDR.EGLE, value: 0.2, at: at(10, 30) },
  { from: ADDR.JONAS, to: ADDR.FAUCET, value: 0.199752074200623, at: at(11, 55) },
];







// -----------------------------------------------------------
// The slate — zone, clock, doubles
// -----------------------------------------------------------
//
// Every graph test file starts each test with startGraphSlate
// — the doubles reset, the zone set (UTC unless a zone is
// given), the clock pinned — and ends it with endGraphSlate,
// which puts the zone back. moveStudentTo lets one test put
// the student in another IANA zone; it must come BEFORE
// freezeClock or holdClockStill, because the pinned instant
// is local time.
//
// Used by:
//   - tests/pages/graph-evm/*.test.jsx
// -----------------------------------------------------------

let zoneBefore;
let zoneMoved = false;

export function moveStudentTo(zone) {
  if (!zoneMoved) {
    zoneBefore = process.env.TZ;
    zoneMoved = true;
  }
  process.env.TZ = zone;
}

export function freezeClock(year = 2026, monthIndex = 8, day = 30, hours = 12, minutes = 0, seconds = 0) {
  vi.useRealTimers();
  vi.useFakeTimers({
    shouldAdvanceTime: true,
    now: new Date(year, monthIndex, day, hours, minutes, seconds),
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
  });
}

// A clock that does not move at all (only Date is faked, the
// timers stay real) — for the "Atnaujinta: prieš 30 sek."
// labels, which a clock following real time would drift off
export function holdClockStill(year = 2026, monthIndex = 8, day = 30, hours = 12, minutes = 0, seconds = 0) {
  vi.useRealTimers();
  vi.useFakeTimers({ now: new Date(year, monthIndex, day, hours, minutes, seconds), toFake: ['Date'] });
}

export function startGraphSlate(zone = 'UTC') {
  resetNetworks();
  moveStudentTo(zone);
  freezeClock();
}

export function endGraphSlate() {
  if (!zoneMoved) return;
  if (zoneBefore === undefined) delete process.env.TZ;
  else process.env.TZ = zoneBefore;
  zoneMoved = false;
}

// Jumps the fake clock, running the timers that fall due
// (a sweep, the midnight tick) and what they set off
export async function advance(ms) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}







// -----------------------------------------------------------
// transfersNoun
// -----------------------------------------------------------
//
// The noun of the canvas's transfer count, declined by hand
// the way a Lithuanian grammar book has it, so every graph
// that boots also checks the page's own agreement: a count
// ending in eleven to nineteen takes the genitive plural, one
// ending in one the singular, one ending in two to nine the
// plural, and one ending in zero the genitive plural again.
//
// Used by:
//   - bootedNetwork (below)
// -----------------------------------------------------------

function transfersNoun(count) {

  const lastTwo = count % 100;
  const last = count % 10;
  if (lastTwo >= 11 && lastTwo <= 19) return 'pervedimų';
  if (last === 1) return 'pervedimas';
  return last === 0 ? 'pervedimų' : 'pervedimai';
}







// -----------------------------------------------------------
// renderGraph / bootedNetwork
// -----------------------------------------------------------
//
// renderGraph mounts the page at /graph/<network> on its
// route pattern (useParams gives it :network). bootedNetwork
// waits for the graph to build its Network — after the root's
// first answer — and for the boot sweep that follows to have
// drawn `transfers` edges (when given), the canvas's name
// counting them with the noun in agreement.
//
// Used by:
//   - tests/pages/graph-evm/*.test.jsx
// -----------------------------------------------------------

export function renderGraph({ network = 'sepolia', ...options } = {}) {
  return renderPage(<GraphPage />, { route: `/graph/${network}`, path: '/graph/:network', ...options });
}

export async function bootedNetwork({ transfers } = {}) {
  await waitFor(() => expect(liveNetwork()).toBeTruthy());
  if (transfers !== undefined) {
    await waitFor(() => expect(canvas()).toHaveAccessibleName(new RegExp(`: ${transfers} ${transfersNoun(transfers)}$`)));
  }
  return liveNetwork();
}







// -----------------------------------------------------------
// Readers
// -----------------------------------------------------------
//
// What a student sees, read the way assistive technology
// reads it: the canvas is the image named after the day's
// transfer graph, its name ending in the day and the count of
// drawn transfers; transferRows gives the hidden table's body
// as the sender, receiver and amount texts of every row, in
// drawing order; dayPicker is the date bar's "Data" dropdown;
// outageNotice is the notice shown while the backend cannot
// be reached, or null when there is none.
//
// Used by:
//   - tests/pages/graph-evm/*.test.jsx
// -----------------------------------------------------------

export const canvas = () => screen.getByRole('img', { name: /^Transakcijų srauto grafikas, / });

export const OUTAGE_TEXT = 'Nepavyko atnaujinti grafiko — rodomi paskutiniai gauti duomenys';

export const outageNotice = () => screen.queryByText(OUTAGE_TEXT);

// The table is visually hidden (sr-only), not aria-hidden: it
// is in the accessibility tree like any table
export function transferRows() {
  const table = screen.getByRole('table', { name: /^Pervedimai / });
  const [, body] = within(table).getAllByRole('rowgroup');
  return within(body).queryAllByRole('row').map((row) => within(row).getAllByRole('cell').map((cell) => cell.textContent));
}

export const dayPicker = () => screen.getByRole('combobox', { name: 'Data' });
