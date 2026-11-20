// -----------------------------------------------------------
//  [*] BitcoinScript — StackView
//
//  The stack — the one thing on the page made to be looked at
//  from the back of a lecture hall. It stands right under the
//  scripts that fill and empty it, drawn the way the word
//  means: a pile in an open-topped jar, the first value at
//  the bottom, the last on top, and the top marked, because
//  the top is where every word of a script reaches. Each
//  value is a tile named for what it is — the same tile that
//  was put into a script a moment ago.
//
//  The pile is the stack as the step under the cursor left it
//  (hooks/useStepper.js) — the end of the check unless
//  somebody is stepping through it. So while a script is
//  being built the jar shows what the scripts, as they are
//  right now, leave behind; and while the check is played it
//  fills and empties word by word. A value put down by a step
//  forward drops in from above.
//
//  The helper stack — the second pile two opcodes move values
//  to and from — gets a jar of its own beside the first while
//  anything is on it.
//
//  Split into (root component last):
//
//    Pile         — one stack as a pile in a jar
//    StackView    — the stack, and the helper stack
//                   (default export)
// -----------------------------------------------------------

import { Box } from '@mui/material';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';

import { MOTION } from '../motion';
import { labelOf } from '../narration';
import { stackAt, stackChange } from '../playback';
import Tile from './Tile';







// -----------------------------------------------------------
// Pile
// -----------------------------------------------------------
//
// A stack as a pile in a jar under its name: the first value
// at the bottom, the last on top, with the top marked. `fresh`
// counts the values from the bottom that were there before
// the step — the ones above them have just been put, and when
// `lively` they drop in. An empty stack says so. The main
// stack's jar is the wider and the taller of the two.
//
// Used by:
//   - StackView (below) — the stack and the helper stack
// -----------------------------------------------------------

function Pile({ title, stack, fresh = stack.length, lexicon, lively = false, main = false }) {
  return (
    <div className={`flex w-full min-w-0 flex-col ${main ? 'max-w-[360px]' : 'max-w-[220px]'}`}>
      <h2 className={`mb-1.5 text-center font-bold text-slate-900 ${main ? 'text-lg' : 'text-sm'}`}>{title}</h2>
      <ol
        aria-label={`${title}, nuo apačios į viršų`}
        className={`flex flex-1 flex-col-reverse justify-start gap-1.5 rounded-b-xl border-2 border-t-0 border-slate-400 bg-slate-100 px-2.5 pb-2.5 pt-3 ${main ? 'min-h-[236px]' : 'min-h-[120px]'}`}
      >
        {stack.length === 0 && <li className="m-auto text-sm text-slate-500">tuščias</li>}
        {stack.map((hex, index) => (
          <Box component="li" key={`${index}:${hex}`} className="min-w-0" sx={lively && index >= fresh ? MOTION.drop() : undefined}>
            <Tile label={labelOf(hex, lexicon)} size={main ? 'lg' : 'md'} wide />
          </Box>
        ))}
        {stack.length > 0 && (
          <li aria-hidden="true" className="flex items-center justify-center text-xs font-semibold text-[var(--color-primary)]">
            <ArrowDropDownIcon fontSize="small" /> viršus
          </li>
        )}
      </ol>
    </div>
  );
}







// -----------------------------------------------------------
// StackView (default export)
// -----------------------------------------------------------
//
// The stack as the step under the cursor left it — empty
// before the first step — and beside it the helper stack,
// while there is anything on it. Only a single step forward
// makes the values it put drop in; arriving at a step any
// other way just shows the pile.
//
// Used by:
//   - Page.jsx — under the scripts
// -----------------------------------------------------------

export default function StackView({ model, stepper }) {
  const { entry, previous, stepped } = stepper;
  const { stack, alt } = stackAt(entry);
  const fresh = entry?.kind === 'item' ? stackChange(previous?.stack ?? [], stack).kept : stack.length;

  return (
    <section aria-label="Stekas" className="flex min-w-0 items-stretch justify-center gap-3">
      <Pile title="Stekas" stack={stack} fresh={fresh} lexicon={model.lexicon} lively={stepped} main />
      {alt.length > 0 && <Pile title="Pagalbinis stekas" stack={alt} lexicon={model.lexicon} />}
    </section>
  );
}
