// -----------------------------------------------------------
//  [*] BitcoinScript — useScriptRows
//
//  The scripts as the rows they are built in, and everything
//  the tray of pieces and the rows have to agree on.
//
//  There are three rows: the unlocking script of transaction
//  B, the locking script of the coin picked on transaction A,
//  and the redeem script — shown once there is a use for it:
//  the lock is a script's hash, one is already built, some
//  script refers to it, or the student has asked for it.
//
//  One row is the one in use. A tile pressed in the tray
//  goes to its end; a press on a row, or on anything in it,
//  makes that row the one in use. The mouse can carry a tile
//  to any place in any row regardless (hooks/useTileDrag.js).
//  Every scene loaded starts with the unlocking script in
//  use, and with the redeem script's row not asked for.
//
//  Split into:
//
//    useScriptRows — the hook (default export)
// -----------------------------------------------------------

import { useState } from 'react';

import { withWord } from '../tiles';
import useTileDrag from './useTileDrag';







// -----------------------------------------------------------
// useScriptRows (default export)
// -----------------------------------------------------------
//
// Takes the state, the model, the way to change things and
// the number of the visit (hooks/usePlayground.js). Hands
// back the rows by name — each with its script as the model
// read it, its text and the way to set it — the name of the
// row in use and `aimAt` to change it, `pick` to send a word
// to the end of that row, the drag (see useTileDrag), whether
// the redeem script's row is shown, and `openRedeem` to ask
// for it.
//
// Used by:
//   - Page.jsx — shared by the tray and the script line
// -----------------------------------------------------------

export default function useScriptRows(state, model, change, visit) {

  // The row in use and whether the redeem script's row was
  // asked for by hand — with the visit they were chosen in;
  // in another visit they count for nothing
  const [held, setHeld] = useState({ visit, aim: 'unlock', redeemOpened: false });
  const { aim, redeemOpened } = held.visit === visit ? held : { aim: 'unlock', redeemOpened: false };

  const coin = model.b.spends;
  const { redeem } = model.b;

  const rows = {
    unlock: { script: model.b.unlock, text: state.unlock, set: (text) => change({ type: 'unlock', text }) },
    lock: { script: coin.script, text: state.outputs[coin.index].lock, set: (text) => change({ type: 'output/lock', index: coin.index, text }) },
    redeem: { script: redeem, text: state.redeem, set: (text) => change({ type: 'redeem', text }) },
  };
  const drag = useTileDrag(rows);

  const redeemShown = redeemOpened || coin.lock.kind === 'p2sh' || redeem.written
    || model.problems.some((problem) => problem.code === 'no-redeem-script');
  const target = aim === 'redeem' && !redeemShown ? 'unlock' : aim;


  return {
    rows,
    target,
    aimAt: (name) => setHeld({ visit, aim: name, redeemOpened }),
    pick: (word) => rows[target].set(withWord(rows[target].text, Infinity, word)),
    drag,
    redeemShown,
    openRedeem: () => setHeld({ visit, aim: 'redeem', redeemOpened: true }),
  };
}
