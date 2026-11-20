// -----------------------------------------------------------
//  [*] BitcoinScript — Player
//
//  What stands beside the stack: the three buttons that move
//  the node through its check, and a few sentences on where
//  it is.
//
//  The check is always done already — the stack shows its end
//  the moment a script changes. "Rodyti žingsniais" goes back
//  to the first word and walks the node through the scripts
//  at reading pace; the two buttons at its sides move one
//  word at a time, back as freely as forward.
//
//  The sentences say what the word under the cursor does and
//  what came of it. At the end of the check they are the
//  verdict — and with it the node's four questions, each with
//  its answer, because a script is only the last of them: a
//  coin that is already spent, or outputs that give away more
//  than the coin holds, turn a transaction down before a
//  single word is run. While something built cannot be read
//  there is no check at all, and the sentences say what
//  stands in the way.
//
//  Split into (root component last):
//
//    ANSWERS      — a question's three answers, as looks
//    Controls     — play, and a step either way
//    Checks       — the node's four questions
//    Explanation  — the sentences for the cursor's place
//    Player       — the whole (default export)
// -----------------------------------------------------------

import { Button, IconButton, Tooltip } from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PauseIcon from '@mui/icons-material/Pause';
import SkipNextIcon from '@mui/icons-material/SkipNext';
import SkipPreviousIcon from '@mui/icons-material/SkipPrevious';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import RemoveCircleOutlineIcon from '@mui/icons-material/RemoveCircleOutline';

import { COLORS } from '../constants';
import { narrate, problemText, whereText } from '../narration';
import { checksOf } from '../playback';


// How an answer to one of the node's questions is drawn, and
// what a screen reader is told
const ANSWERS = {
  passed: { Icon: CheckCircleIcon, colour: COLORS.VALID, said: 'taip' },
  failed: { Icon: CancelIcon, colour: COLORS.INVALID, said: 'ne' },
  unasked: { Icon: RemoveCircleOutlineIcon, colour: COLORS.MUTED, said: 'neklausta' },
};







// -----------------------------------------------------------
// Controls
// -----------------------------------------------------------
//
// The three buttons: a step back, play — which becomes stop
// while the check is playing — and a step forward. Without a
// check to walk through none of them can be pressed.
//
// Used by:
//   - Player (below)
// -----------------------------------------------------------

function Controls({ stepper, ready }) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <Tooltip title="Žingsnis atgal" arrow>
        <span>
          <IconButton aria-label="Žingsnis atgal" disabled={!ready || !stepper.started} onClick={stepper.back}><SkipPreviousIcon /></IconButton>
        </span>
      </Tooltip>

      <Button
        disabled={!ready}
        startIcon={stepper.playing ? <PauseIcon /> : <PlayArrowIcon />}
        onClick={stepper.playing ? stepper.pause : stepper.play}
        sx={{ textTransform: 'none', minWidth: 188 }}
      >
        {stepper.playing ? 'Stabdyti' : 'Rodyti žingsniais'}
      </Button>

      <Tooltip title="Žingsnis pirmyn" arrow>
        <span>
          <IconButton aria-label="Žingsnis pirmyn" disabled={!ready || stepper.finished} onClick={stepper.next}><SkipNextIcon /></IconButton>
        </span>
      </Tooltip>
    </div>
  );
}







// -----------------------------------------------------------
// Checks
// -----------------------------------------------------------
//
// The node's four questions in the order it asks them, each
// with its answer: yes, no, or never asked because an earlier
// one was a no. A question's full wording is its tooltip.
//
// Used by:
//   - Explanation (below) — under the verdict
// -----------------------------------------------------------

function Checks({ timeline }) {
  return (
    <ul aria-label="Mazgo klausimai" className="flex flex-wrap gap-x-4 gap-y-1">
      {checksOf(timeline).map((check) => {
        const { Icon, colour, said } = ANSWERS[check.state];

        return (
          <Tooltip key={check.key} title={check.question} arrow>
            <li data-state={check.state} className="flex items-center gap-1 text-sm font-semibold" style={{ color: colour }}>
              <Icon aria-hidden="true" sx={{ fontSize: 18 }} />
              {check.name}
              <span className="sr-only">: {said}</span>
            </li>
          </Tooltip>
        );
      })}
    </ul>
  );
}







// -----------------------------------------------------------
// Explanation
// -----------------------------------------------------------
//
// The sentences for where the cursor stands: what cannot be
// read, while there is no check; that the stack is empty,
// before the first word; what a word does and what came of
// it; and at the end the verdict, in the verdict's colour,
// with the node's four questions under it.
//
// Used by:
//   - Player (below)
// -----------------------------------------------------------

function Explanation({ model, stepper, verdict }) {
  if (verdict === 'blocked') {
    return (
      <>
        <h3 className="text-base font-bold text-slate-900">Transakcija dar nebaigta</h3>
        <ul className="flex flex-col gap-1 text-sm text-slate-700">
          {model.problems.map((problem, index) => (
            <li key={index}><span className="font-semibold">{whereText(problem)}.</span> {problemText(problem)}</li>
          ))}
        </ul>
      </>
    );
  }

  if (!stepper.entry) {
    return (
      <>
        <h3 className="text-base font-bold text-slate-900">Pradžia</h3>
        <p className="text-sm text-slate-700">Stekas tuščias. Mazgas pradeda nuo atrakinimo skripto ir eina per žodžius iš eilės.</p>
      </>
    );
  }

  const { heading, lines } = narrate(stepper.entry, model);
  const judged = verdict === 'valid' || verdict === 'invalid';
  const Mark = verdict === 'valid' ? CheckCircleIcon : CancelIcon;

  return (
    <>
      <h3 className="flex items-center gap-1.5 text-base font-bold" style={{ color: judged ? (verdict === 'valid' ? COLORS.VALID : COLORS.INVALID) : COLORS.INK }}>
        {judged && <Mark aria-hidden="true" fontSize="small" />}
        {heading}
      </h3>
      {judged && <Checks timeline={model.verification.timeline} />}
      {lines.map((line, index) => <p key={index} className="text-sm text-slate-700">{line}</p>)}
    </>
  );
}







// -----------------------------------------------------------
// Player (default export)
// -----------------------------------------------------------
//
// The buttons, and under them the sentences — announced to a
// screen reader as they change.
//
// Used by:
//   - Page.jsx — beside the stack
// -----------------------------------------------------------

export default function Player({ model, stepper, verdict }) {
  return (
    <section aria-label="Mazgo patikra" className="flex min-w-0 flex-col gap-3">
      <Controls stepper={stepper} ready={model.verification !== null} />
      <div role="status" data-verdict={verdict} className="flex max-w-[62ch] flex-col gap-1.5">
        <Explanation model={model} stepper={stepper} verdict={verdict} />
      </div>
    </section>
  );
}
