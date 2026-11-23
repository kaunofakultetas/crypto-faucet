// -----------------------------------------------------------
//  [*] BitcoinScript — useScriptRows
//
//  The scripts as the rows they are built in, and everything
//  the tray of pieces and the rows have to agree on.
//
//  A row is something a student builds from tiles: the
//  unlocking script of transaction B and the witness of its
//  input, the locking script of the coin picked on
//  transaction A, and the scripts a lock only holds a trace
//  of — a redeem script, a witness script, the two scripts a
//  Taproot key may hide. One row more is only read: the
//  script a node builds itself for a coin paid to a witness
//  key hash.
//
//  Few of them are on the page at once. A row is shown when
//  there is a use for it: the lock asks for it, something is
//  already built in it, some word elsewhere refers to it, or
//  the student has asked for it. The witness and the
//  unlocking script are the two things B's input carries; a
//  lock that is a witness program leaves the unlocking script
//  empty, and the page then leaves its row out.
//
//  One row is the one in use. A tile pressed in the tray
//  goes to its end; a press on a row, or on anything in it,
//  makes that row the one in use. The mouse can carry a tile
//  to any place in any row regardless (hooks/useTileDrag.js).
//  Every scene loaded starts with the unlocking script in
//  use — the witness where that row is left out — and with
//  no row asked for.
//
//  The tray offers other pieces of a key pair where the page
//  is about Taproot, and whether it is, is decided here too:
//  the scene loaded is, the Taproot scripts are on the page,
//  or the coin is locked to a Taproot key.
//
//  Split into:
//
//    written       — whether a script's text holds a word
//    useScriptRows — the hook (default export)
// -----------------------------------------------------------

import { useState } from 'react';

import { withWord } from '../tiles';
import useTileDrag from './useTileDrag';







// -----------------------------------------------------------
// written
// -----------------------------------------------------------
//
// Whether a script's text holds any word at all — a row with
// something built in it is shown whatever the lock asks for.
//
// Used by:
//   - useScriptRows (below)
// -----------------------------------------------------------

const written = (text) => text.trim() !== '';







// -----------------------------------------------------------
// useScriptRows (default export)
// -----------------------------------------------------------
//
// Takes the state, the model, the way to change things, the
// number of the visit and the scene in use
// (hooks/usePlayground.js). Hands back the rows by name —
// each with its script as the model read it, its text and
// the way to set it — which of them are shown, the name of
// the row in use and `aimAt` to change it, `pick` to send a
// word to the end of that row, the drag (see useTileDrag),
// `open` to ask for a row that is not shown — the two Taproot
// scripts go by one name, "leaves" — and whether the page is
// about Taproot.
//
// Used by:
//   - Page.jsx — shared by the tray, the script line and the
//     drawer of further settings
// -----------------------------------------------------------

export default function useScriptRows(state, model, change, visit, example) {
  // The row in use — none chosen yet — and the rows asked for
  // by hand, with the visit they were chosen in; in another
  // visit they count for nothing
  const [held, setHeld] = useState({ visit, aim: null, opened: [] });
  const { aim, opened } = held.visit === visit ? held : { aim: null, opened: [] };

  const { b } = model;
  const coin = b.spends;
  const asked = (name) => opened.includes(name);
  const missed = (...codes) => model.problems.some((problem) => codes.includes(problem.code));

  const rows = {
    unlock: { script: b.unlock, text: state.unlock, set: (text) => change({ type: 'unlock', text }) },
    witness: { script: b.witness, text: state.witness, set: (text) => change({ type: 'witness', text }) },
    lock: { script: coin.script, text: state.outputs[coin.index].lock, set: (text) => change({ type: 'output/lock', index: coin.index, text }) },
    redeem: { script: b.redeem, text: state.redeem, set: (text) => change({ type: 'redeem', text }) },
    witnessScript: { script: b.witnessScript, text: state.witnessScript, set: (text) => change({ type: 'witness-script', text }) },
    leafA: { script: b.leaves[0], text: state.leaves[0], set: (text) => change({ type: 'leaf', index: 0, text }) },
    leafB: { script: b.leaves[1], text: state.leaves[1], set: (text) => change({ type: 'leaf', index: 1, text }) },
  };
  const drag = useTileDrag(rows);

  const leaves = asked('leaves') || b.leaves.some((leaf) => leaf.written) || missed('no-leaf', 'no-control-block');
  const shown = {
    unlock: asked('unlock') || b.program === null || b.program.wrapped || written(state.unlock),
    witness: asked('witness') || b.program !== null || written(state.witness),
    lock: true,
    redeem: asked('redeem') || coin.lock.kind === 'p2sh' || b.redeem.written || missed('no-redeem-script'),
    witnessScript: asked('witnessScript') || b.program?.kind === 'p2wsh' || b.witnessScript.written || missed('no-witness-script'),
    program: b.implied !== null,
    leaves,
    leafA: leaves,
    leafB: leaves,
  };

  const first = shown.unlock ? 'unlock' : 'witness';
  const target = aim !== null && shown[aim] ? aim : first;
  const startsTaproot = example.state.leaves.some(written) || example.state.outputs.some((output) => /<tapkey:/i.test(output.lock));

  return {
    rows,
    shown,
    target,
    aimAt: (name) => setHeld({ visit, aim: name, opened }),
    pick: (word) => rows[target].set(withWord(rows[target].text, Infinity, word)),
    drag,
    open: (name) => setHeld({ visit, aim: name === 'leaves' ? 'leafA' : name, opened: [...opened, name] }),
    taproot: startsTaproot || leaves || coin.lock.kind === 'p2tr',
  };
}
