// -----------------------------------------------------------
//  [*] BitcoinScript — a check, as far as the cursor has got
//
//  The node's whole check of transaction B is worked out the
//  moment B is built (engine/node.js hands it over as a
//  timeline); the page then only moves a cursor along it.
//  Not every entry of the timeline is a place to stop: the
//  page walks the words of the scripts, where the stack
//  changes, and the verdict. Everything the page shows of the
//  check at one cursor position is worked out here:
//
//    - the state of transaction B as a whole: not yet built,
//      a claim nobody has checked, being checked, accepted or
//      turned down
//    - how far each of the node's questions has got
//    - where the node stands in each script — which words
//      are behind it, which one it is on, which it skipped or
//      broke at — as a row of tiles
//    - the stack as it stands at the cursor
//    - what the word under the cursor did to the stack: which
//      values it left alone, which it took and which it put
//
//  Split into:
//
//    stopsOf      — the steps of the check worth stopping at
//    verdictOf    — the state of transaction B
//    checksOf     — the node's questions, each with its answer
//    stepOf       — the node's place at one word of a script
//    tapeOf       — a script as tiles that show that place
//    stackAt      — the two stacks at the cursor
//    stackChange  — a step's doing, as kept, taken and put
// -----------------------------------------------------------

import { STAGES, wordLabel } from './narration';







// -----------------------------------------------------------
// stopsOf
// -----------------------------------------------------------
//
// The entries of the node's timeline the page stops at, in
// order: every word of a script, the moment a redeem script
// is taken off the stack, and the verdict. The node's first
// three questions — the coin, the amounts, the time — are no
// stops: nothing is seen to happen at them, and when one of
// them is where the node says no, the verdict says so. The
// hand-over from the unlocking script to the lock is no stop
// either; the stack does not change there.
//
// Used by:
//   - Page.jsx — the steps the cursor moves along
// -----------------------------------------------------------

export const stopsOf = (timeline) => timeline.filter((entry) => entry.kind === 'item' || entry.kind === 'redeem' || entry.stage === 'verdict');







// -----------------------------------------------------------
// verdictOf
// -----------------------------------------------------------
//
// The state of transaction B with the cursor where it is:
// "blocked" while something built cannot be read and there is
// nothing to check, "unchecked" with the cursor in front of
// the first step, "checking" on the way, and the node's
// "valid" or "invalid" only once the cursor stands on the
// verdict.
//
// Used by:
//   - Page.jsx — the one verdict every part is shown
// -----------------------------------------------------------

export function verdictOf(verification, stepper) {
  if (!verification) return 'blocked';
  if (!stepper.started) return 'unchecked';
  if (!stepper.finished) return 'checking';
  return verification.valid ? 'valid' : 'invalid';
}







// -----------------------------------------------------------
// checksOf
// -----------------------------------------------------------
//
// The node's four questions with the answer each got: yes,
// no — or never asked, because the node had stopped at an
// earlier one.
//
// Used by:
//   - components/Player.jsx — the node's questions, under the
//     verdict
// -----------------------------------------------------------

export function checksOf(timeline) {
  const verdict = timeline.at(-1);

  return STAGES.slice(0, -1).map((stage) => {
    const asked = timeline.some((entry) => entry.stage === stage.key);
    return { ...stage, state: !asked ? 'unasked' : verdict.failed === stage.key ? 'failed' : 'passed' };
  });
}







// -----------------------------------------------------------
// stepOf
// -----------------------------------------------------------
//
// The node's place at one word of one script: not reached
// yet, behind it, the one it stands on, the one it broke at,
// or skipped in a branch not taken — "skipping" while the
// node is passing over it.
//
// Used by:
//   - tapeOf (below)
// -----------------------------------------------------------

export function stepOf(timeline, cursor, phase, index) {
  const at = timeline.findIndex((entry) => entry.kind === 'item' && entry.phase === phase && entry.index === index);
  if (at === -1 || at > cursor) return 'todo';

  const entry = timeline[at];
  if (!entry.ok) return 'failed';
  if (entry.skipped) return at === cursor ? 'skipping' : 'skipped';
  return at === cursor ? 'current' : 'done';
}







// -----------------------------------------------------------
// tapeOf
// -----------------------------------------------------------
//
// A script as a row of tiles, each named for what it is and
// marked with the node's place at it, given the step the
// cursor stands on. Every word of the script gets a tile —
// while a word cannot be read there is no check, and the row
// shows the script as it stands, the unread word among the
// rest.
//
// The marks are for a check under way. Once the cursor rests
// on the verdict — where it rests whenever nobody is stepping
// — a word the node has simply passed is shown as plain as a
// word it never reached: a finished script should look like a
// script, not like something switched off. What it broke at
// and what it skipped stay marked.
//
// Used by:
//   - Page.jsx — the scripts in the rows they are built in
// -----------------------------------------------------------

export function tapeOf(phase, script, lexicon, timeline, entry) {
  const cursor = timeline && entry ? timeline.indexOf(entry) : -1;
  const settled = !timeline || entry?.stage === 'verdict';
  const mark = (index) => {
    const step = timeline ? stepOf(timeline, cursor, phase, index) : 'todo';
    return settled && step === 'done' ? 'todo' : step;
  };

  return script.words.map((word, index) => ({
    key: `${index}:${word.text}`,
    word,
    label: wordLabel(word, lexicon),
    step: mark(index),
  }));
}







// -----------------------------------------------------------
// stackAt
// -----------------------------------------------------------
//
// The stack and the helper stack as a step left them — both
// empty before the first step.
//
// Used by:
//   - components/StackView.jsx — the stack that is always on
//     show
// -----------------------------------------------------------

export const stackAt = (entry) => ({ stack: entry?.stack ?? [], alt: entry?.alt ?? [] });







// -----------------------------------------------------------
// stackChange
// -----------------------------------------------------------
//
// What one step did to the stack, told from the stack before
// it and the stack after: how many values at the bottom it
// left alone, which it took from above them and which it put
// there instead — both listed from the lower to the upper.
//
// Used by:
//   - components/StackView.jsx — which values a step has just
//     put down
// -----------------------------------------------------------

export function stackChange(before, after) {
  let kept = 0;
  while (kept < before.length && kept < after.length && before[kept] === after[kept]) kept += 1;
  return { kept, taken: before.slice(kept), put: after.slice(kept) };
}
