// -----------------------------------------------------------
//  [*] Pages — Bitcoin script playground (route /bitcoin-script)
//
//  A place to build Bitcoin's locks and open them, and to
//  watch a full node decide. Two transactions stand on top:
//  A makes coins, each under a lock, and B spends one of
//  them. Under them is the one thing the page is about — the
//  two scripts in a line, in the order a node runs them, and
//  the stack they leave behind.
//
//  Nothing is typed as a script and nothing has to be run.
//  A script is built from tiles taken from the tray at the
//  side — a key pair's signature, public key and key hash,
//  the opcodes, data made on the spot — and the moment a tile
//  lands, the node's whole check is done again: the stack
//  shows what the scripts as they stand leave behind, and the
//  arrow between the transactions says whether B opens the
//  lock. Going through the check word by word is then one
//  press away — the play button, or a press on any word.
//
//  The page opens on the everyday lock, already opened; the
//  scenes above the transactions set it to other locks, from
//  two numbers that must add up to a script behind its hash.
//  Every change can be taken back, and nothing is kept beyond
//  the visit.
//
//  Everything is worked out in the browser, with real keys
//  and real signatures on Bitcoin's curve (engine/); the page
//  talks to no server.
//
//  The page itself only joins the parts:
//
//    hooks/usePlayground.js — the state and the model
//    hooks/useStepper.js    — the cursor along the check
//    hooks/useScriptRows.js — the scripts as rows of tiles
//    playback.js            — the check at the cursor
//    components/            — what is on the screen
// -----------------------------------------------------------

import { useMemo } from 'react';

import usePlayground from './hooks/usePlayground';
import useScriptRows from './hooks/useScriptRows';
import useStepper from './hooks/useStepper';
import { stopsOf, tapeOf, verdictOf } from './playback';
import More from './components/More';
import PieceTray from './components/PieceTray';
import Player from './components/Player';
import SceneBar from './components/SceneBar';
import ScriptLine from './components/ScriptLine';
import StackView from './components/StackView';
import { Arrow, TransactionA, TransactionB } from './components/Transactions';







// -----------------------------------------------------------
// BitcoinScriptPage (default export)
// -----------------------------------------------------------
//
// The scenes on top, the two transactions with the arrow
// between them, and under them the tray of pieces beside the
// stage: the scripts, the stack with the player, and the
// drawer of further settings. On a narrow screen the stage
// comes first and the tray under it.
//
// Used by:
//   - App.jsx — route /bitcoin-script
// -----------------------------------------------------------

export default function BitcoinScriptPage() {
  const { example, visit, state, model, change, load, restart, undo, canUndo, addKey, freeze, thaw } = usePlayground();

  const timeline = model.verification?.timeline ?? null;
  const stops = useMemo(() => (timeline ? stopsOf(timeline) : null), [timeline]);
  const stepper = useStepper(stops);
  const rows = useScriptRows(state, model, change, visit);

  const verdict = verdictOf(model.verification, stepper);
  const tapes = {
    unlock: tapeOf('unlock', model.b.unlock, model.lexicon, timeline, stepper.entry),
    lock: tapeOf('lock', model.b.spends.script, model.lexicon, timeline, stepper.entry),
    redeem: tapeOf('redeem', model.b.redeem, model.lexicon, timeline, stepper.entry),
  };

  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-4 p-4">
      <SceneBar example={example} canUndo={canUndo} onLoad={load} onUndo={undo} onRestart={restart} />

      <div className="grid items-stretch gap-2 md:grid-cols-[minmax(0,5fr)_auto_minmax(0,7fr)]">
        <TransactionA state={state} model={model} verdict={verdict} change={change} />
        <Arrow verdict={verdict} />
        <TransactionB state={state} model={model} verdict={verdict} change={change} />
      </div>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <PieceTray state={state} model={model} rows={rows} change={change} addKey={addKey} className="order-2 lg:order-1 lg:w-[360px] lg:shrink-0" />

        <div className="order-1 flex min-w-0 flex-1 flex-col gap-3 lg:order-2">
          <div className="card-surface flex flex-col gap-5 p-3.5 sm:p-4">
            <ScriptLine tapes={tapes} rows={rows} stepper={stepper} stops={stops} lexicon={model.lexicon} />

            <div className="grid gap-5 md:grid-cols-2">
              <StackView model={model} stepper={stepper} />
              <Player model={model} stepper={stepper} verdict={verdict} />
            </div>
          </div>

          <More key={visit} state={state} model={model} rows={rows} change={change} freeze={freeze} thaw={thaw} startOpen={example.state.lockTime !== '0'} />
        </div>
      </div>
    </div>
  );
}
